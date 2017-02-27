function getCppType(type) {
    switch (type.tag) {
        case 'base_type':
        case 'typedef':
        case 'enumeration_type':
        case 'class_type':
            return type.name;
        case 'pointer_type':
            if (type.type.tag === 'const_type') {
                if (type.type.type) {
                    return 'const ' + type.type.type.name + '*';
                }
                else {
                    console.warn('const void* is not properly supported, as we cannot infer what is being passed in...');
                    return 'const void*';
                }
            }
            return type.type.name + '*';
        default:
            console.warn('Unknown tag', type.tag, type);
            break;
    }
}

function createMemberFunction(obj, fn, params, typeCheckString, castString, argString) {
    let returnValues = [];

    if (!fn.type) { /* no return value */
        returnValues.push(`native_ptr->${fn.name}(${argString});`);
        returnValues.push(`return jerry_create_undefined();`);
    }
    else {
        let cppType = getCppType(fn.type);

        returnValues.push(`${cppType} result = native_ptr->${fn.name}(${argString});`);

        function handleBaseType(type) {
            switch (type.name) {
                case 'float':
                    returnValues.push(`return jerry_create_number(result);`);
                    break;
                case 'int':
                    returnValues.push(`return jerry_create_number(result);`);
                    break;
                default:
                    console.warn('Unknown return base_type', fn.type.name, fn.type);
                    return;
            }
        }

        function handlePointerType(type) {
            return returnValues.push(`return mbed_js_wrap_native_object(result);`);
        }

        switch (fn.type.tag) {
            case 'base_type':
                handleBaseType(fn.type);
                break;
            case 'pointer_type':
                handlePointerType(fn.type);
                break;
            case 'typedef':
                if (fn.type.type.tag === 'base_type') {
                    handleBaseType(fn.type.type);
                }
                else if (fn.type.type.tag === 'pointer_type') {
                    handlePointerType(fn.type.type);
                }
                else {
                    console.warn('Unknown return typedef', fn.type.type.name, fn.type);
                }
                break;
            default:
                console.warn('Unknown return tag', fn.type.tag, fn.type);
                return;
        }


        if (!cppType) {
            console.warn('Unknown return type', fn.type);
            return;
        }
    }

    let returnString = returnValues.map(a => '    ' + a).join('\n');

    let out = `/**
 * ${obj.name}#${fn.name} (native JavaScript method)
 */
DECLARE_CLASS_FUNCTION(${obj.name}, ${fn.name}) {
    CHECK_ARGUMENT_COUNT(${obj.name}, ${fn.name}, (args_count == ${params.length - 1}));
${typeCheckString}

    uintptr_t ptr_val;
    jerry_get_object_native_handle(this_obj, &ptr_val);

    ${obj.name}* native_ptr = reinterpret_cast<${obj.name}*>(ptr_val);

${castString}

${returnString}
}`;
    return out;
}

function createConstructor(obj, fn, params, typeCheckString, castString, argString, allFns) {

    let fnString = allFns.filter(f => {
        return isMemberFunction(obj, f);
    }).map(p => {
        return `    ATTACH_CLASS_FUNCTION(js_object, ${obj.name}, ${p.name});`;
    }).join('\n');

    let out = `
/**
 * ${obj.name}#destructor
 *
 * Called if/when the ${obj.name} is GC'ed.
 */
void NAME_FOR_CLASS_NATIVE_DESTRUCTOR(${obj.name})(const uintptr_t native_handle) {
    delete reinterpret_cast<${obj.name}*>(native_handle);
}

/**
 * mbed_js_wrap_native_object (turns a native ${obj.name} object into a JS object)
 */
static jerry_value_t mbed_js_wrap_native_object(${obj.name}* ptr) {
    uintptr_t native_ptr = (uintptr_t) ptr;

    jerry_value_t js_object = jerry_create_object();
    jerry_set_object_native_handle(js_object, native_ptr, NAME_FOR_CLASS_NATIVE_DESTRUCTOR(${obj.name}));

${fnString}

    return js_object;
}

/**
 * ${obj.name} (native JavaScript constructor)
 */
DECLARE_CLASS_CONSTRUCTOR(${obj.name}) {
    CHECK_ARGUMENT_COUNT(${obj.name}, __constructor, (args_count == ${params.length - 1}));
${typeCheckString}

${castString}

    // Create the native object
    ${obj.name}* native_obj = new ${obj.name}(${argString});

    return mbed_js_wrap_native_object(native_obj);
}`;

    return out;
}

function isMemberFunction(obj, fn) {
    if (fn.name.indexOf('operator') === 0) return false;

    if (obj.name === fn.name && fn.type.tag === 'pointer_type' && fn.type.type === obj) return false;

    let params = fn.children.filter(c => c.tag === 'formal_parameter');
    if (params[0].type.tag !== 'pointer_type' || params[0].type.type !== obj) return false;

    // destructor
    if (fn.name === '~' + obj.name) return false;

    return true;
}

function isConstructor(obj, fn) {
    return obj.name === fn.name && fn.type.tag === 'pointer_type' && fn.type.type === obj;
}

function fnToString(obj, fn, allFns) {
    console.log(obj.name + '#' + fn.name);

    if (fn.name === 'setColorRGB') {
        debugger;
    }

    var isCtor = false;

    if (isConstructor(obj, fn)) {
        isCtor = true;
        fn.name = '__constructor';
    }
    else if (!isMemberFunction(obj, fn)) {
        console.log('Cannot handle this function');
        return;
    }

    // first we need to check if it's a static function or not...
    let params = fn.children.filter(c => c.tag === 'formal_parameter');

    // so all other parameters are for this function.
    // Q: can we detect which parameters are optional?
    let checkArgumentTypes = [];
    let casting = [];

    let enums = [];

    for (let ix = 1; ix < params.length; ix++) {
        let p = params[ix];
        let cppType = getCppType(p.type);
        if (!cppType) return;

        function handleBaseType(type) {
            switch (type.name) {
                case 'float':
                case 'int':
                case 'unsigned int':
                    checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ALWAYS(${obj.name}, ${fn.name}, ${ix-1}, number);`);
                    casting.push(`double jArg${ix-1} = jerry_get_number_value(args[${ix-1}]);`);
                    casting.push(`${cppType} arg${ix-1} = static_cast<${cppType}>(jArg${ix-1});`);
                    break;
                default:
                    console.warn('Unknown fnparam base_type', type.name, type);
                    return;
            }
        }

        function handleEnumerationType(type) {
            checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ALWAYS(${obj.name}, ${fn.name}, ${ix-1}, number);`);
            casting.push(`${cppType} arg${ix-1} = ${cppType}(jerry_get_number_value(args[${ix-1}]));`);

            // Prevent PinNames from showing up here...
            if (type.name) {
                enums.push({
                    name: type.name,
                    values: type.children.map(c => c.name)
                });
            }
        }

        function handleClassType(type) {
            if (type.name.indexOf('basic_string') === 0) {
                checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ALWAYS(${obj.name}, ${fn.name}, ${ix-1}, string);`);

                casting.push(`jerry_size_t szArg${ix-1} = jerry_get_string_size(args[${ix-1}]);`);
                casting.push(`jerry_char_t *sArg${ix-1} = (jerry_char_t*) calloc(szArg${ix-1} + 1, sizeof(jerry_char_t));`);
                casting.push(`jerry_string_to_char_buffer(args[${ix-1}], sArg${ix-1}, szArg${ix-1});`);
                casting.push(`string arg${ix-1}(sArg${ix-1});`);
            }
            else {
                console.warn('Unknown class type', type.name, type);
            }
        }

        function handleTypedef(type) {
            if (type.tag === 'enumeration_type') {
                handleEnumerationType(type);
            }
            else if (type.tag === 'base_type') {
                handleBaseType(type);
            }
            else if (type.tag === 'class_type') {
                handleClassType(type);
            }
            else if (type.tag === 'typedef') {
                if (type.name.indexOf('__uint') === 0) {
                    return handleBaseType({
                        name: 'int'
                    });
                }

                handleTypedef(type.type);
            }
            else {
                console.warn('Unknown fnparam typedef', type.tag, type);
                return;
            }
        }

        switch (p.type.tag) {
            case 'base_type':
                handleBaseType(p.type);
                break;
            case 'class_type':
                handleClassType(p.type);
                break;
            case 'typedef':
                handleTypedef(p.type.type);
                break;
            case 'pointer_type':
                checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ALWAYS(${obj.name}, ${fn.name}, ${ix-1}, object);`);
                casting.push(`${cppType} arg${ix-1} = (${cppType}) jsmbed_wrap_get_native_handle(args[${ix-1}]);`);
                break;
            case 'enumeration_type':
                handleEnumerationType(p.type);
                break;
            default:
                console.warn('Unknown fnparam tag', p.type.tag, p.type);
                return;
        }
    }

    let typeCheckString = checkArgumentTypes.map(a => '    ' + a).join('\n');
    let castString = casting.map(a => '    ' + a).join('\n');
    let argString = Array.apply(null, { length: params.length - 1 }).map((v, ix) => 'arg' + ix).join(', ');

    // @todo: actually do something with these...

    if (!isCtor) {
        let text = createMemberFunction(obj, fn, params, typeCheckString, castString, argString);
        return {
            text: text,
            enums: enums
        }
    }
    else {
        fn.name = obj.name; // restore state
        let text = createConstructor(obj, fn, params, typeCheckString, castString, argString, allFns);
        return {
            text: text,
            enums: enums
        };
    }
};

module.exports = {
    fnToString: fnToString,
    isConstructor: isConstructor
};
