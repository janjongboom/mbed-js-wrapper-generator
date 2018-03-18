function getCppType(type) {
    switch (type.tag) {
        case 'base_type':
        case 'typedef':
        case 'enumeration_type':
        case 'class_type':
        case 'structure_type':
            return type.name;
        case 'reference_type':
            return getCppType(type.type);
        case 'pointer_type':
            if (type.type && type.type.tag === 'const_type') {
                if (type.type.type) {
                    return 'const ' + type.type.type.name + '*';
                }
                else {
                    console.warn('const void* is not properly supported, as we cannot infer what is being passed in...', type);
                    return 'const void*';
                }
            }
            if (!type.type) {
                return 'void*';
            }

            return type.type.name + '*';
        case 'typedef':
            return getCppType(type.type);
        default:
            console.warn('Unknown tag', type.tag, type);
            break;
    }
}

function createMemberFunction(obj, jsClassName, fn, params, typeCheckString, castString, argString) {
    let returnValues = [];

    if (!fn.type) { /* no return value */
        returnValues.push(`native_ptr->${fn.name}(${argString});`);
        returnValues.push(`return jerry_create_undefined();`);
    }
    else {
        let cppType = getCppType(fn.type);

        returnValues.push(`${cppType} result = native_ptr->${fn.name}(${argString});`);

        if (cppType === 'string') {
            debugger;
        }

        function handleBaseType(type) {
            switch (type.name) {
                case 'float':
                case 'int':
                case 'unsigned int':
                case 'long unsigned int':
                case 'signed char':
                case 'unsigned char':
                case 'long':
                case 'short':
                case 'short int':
                case 'short unsigned int':
                    returnValues.push(`return jerry_create_number(result);`);
                    break;
                case 'bool':
                    returnValues.push(`return jerry_create_boolean(result);`);
                    break;
                case 'string':
                    returnValues.push(`return jerry_create_string((const jerry_char_t*) result.c_str());`);
                    break;
                default:
                    console.warn('Unknown return base_type', type.name, type);
                    return;
            }
        }

        function handlePointerType(type) {
            returnValues.push(`if (result == NULL) return jerry_create_undefined();`);
            returnValues.push(`return mbed_js_wrap_native_object(result);`);
        }

        function handleTypedef(type) {
            if (type.type.tag === 'base_type') {
                handleBaseType(type.type);
            }
            else if (type.type.tag === 'pointer_type') {
                handlePointerType(type.type);
            }
            else if (type.name === 'string') {
                handleBaseType({ name: 'string' });
            }
            else if (type.type.tag === 'typedef') {
                handleTypedef(type.type);
            }
            else {
                console.warn('Unknown return typedef', type.type.name, type);
            }
        }

        switch (fn.type.tag) {
            case 'base_type':
                handleBaseType(fn.type);
                break;
            case 'pointer_type':
                handlePointerType(fn.type);
                break;
            case 'typedef':
                handleTypedef(fn.type);
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

    let out = `${typeCheckString}

    uintptr_t ptr_val;
    jerry_get_object_native_handle(this_obj, &ptr_val);

    ${obj.name}* native_ptr = reinterpret_cast<${obj.name}*>(ptr_val);

${castString}

${returnString}`;
    return out;
}

function createDestructor(obj, jsClassName) {
    return `/**
 * ${jsClassName}#destructor
 *
 * Called if/when the ${jsClassName} is GC'ed.
 */
void NAME_FOR_CLASS_NATIVE_DESTRUCTOR(${jsClassName})(const uintptr_t native_handle) {
    delete reinterpret_cast<${obj.name}*>(native_handle);
}`;
}

function createNativeWrapper(obj, jsClassName, allFns) {
    let added = [];

    let fnString = allFns.filter(f => {
        return isMemberFunction(obj, f);
    }).map(p => {
        if (added.indexOf(p.name) !== -1) return null;
        added.push(p.name);
        return `    ATTACH_CLASS_FUNCTION(js_object, ${jsClassName}, ${p.name});`;
    }).filter(f => !!f).join('\n');

    let out = `
/**
 * mbed_js_wrap_native_object (turns a native ${obj.name} object into a JS object)
 */
jerry_value_t mbed_js_wrap_native_object(${obj.name}* ptr) {
    uintptr_t native_ptr = (uintptr_t) ptr;

    jerry_value_t js_object = jerry_create_object();
    jerry_set_object_native_handle(js_object, native_ptr, NAME_FOR_CLASS_NATIVE_DESTRUCTOR(${jsClassName}));

${fnString}

    return js_object;
}`;

    return out;
}

function createConstructor(obj, jsClassName, fn, params, typeCheckString, castString, argString, allFns) {
    return `${typeCheckString}

${castString}

    // Create the native object
    ${obj.name}* native_obj = new ${obj.name}(${argString});

    return mbed_js_wrap_native_object(native_obj);`;

    return out;
}

function isMemberFunction(obj, fn) {
    if (fn.name.indexOf('operator') === 0) return false;

    if (obj.name === fn.name && fn.type.tag === 'pointer_type' && fn.type.type === obj) return false;

    let params = fn.children.filter(c => c.tag === 'formal_parameter');
    if (params[0].type.tag !== 'pointer_type' || params[0].type.type !== obj) return false;

    // destructor
    if (fn.name === '~' + obj.name) return false;

    // copy
    if (fn.name === obj.name && params.length === 2 && params[1].type.tag === 'reference_type' && params[1].type.type.tag === 'const_type' && params[1].type.type.type === obj) {
        return false;
    }


    return true;
}

function isConstructor(obj, fn) {
    // Templates
    let objName = obj.name;
    if (objName.indexOf('<') > -1) {
        objName = objName.split('<')[0];
    }

    let params = fn.children.filter(c => c.tag === 'formal_parameter');

    if (fn.name === obj.name) {
        debugger;
    }

    // copy
    if (fn.name === obj.name && params.length === 2 && params[1].type.tag === 'reference_type' && params[1].type.type.tag === 'const_type' && params[1].type.type.type === obj) {
        return false;
    }

    return objName === fn.name && fn.type.tag === 'pointer_type' && fn.type.type === obj;
}

function fnToString(obj, jsClassName, fn, allFns) {
    console.log(obj.name + '#' + fn.name);

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
                case 'signed char':
                case 'unsigned char':
                case 'long':
                case 'short':
                case 'short int':
                case 'long unsigned int':
                case 'short unsigned int':
                    checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ON_CONDITION(${jsClassName}, ${fn.name}, ${ix-1}, number, (args_count == ${params.length - 1}));`);
                    casting.push(`double jArg${ix-1} = jerry_get_number_value(args[${ix-1}]);`);
                    casting.push(`${cppType} arg${ix-1} = static_cast<${cppType}>(jArg${ix-1});`);
                    break;
                case 'bool':
                    checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ON_CONDITION(${jsClassName}, ${fn.name}, ${ix-1}, boolean, (args_count == ${params.length - 1}));`);
                    casting.push(`bool arg${ix-1} = jerry_get_boolean_value(args[${ix-1}]);`);
                    break;
                default:
                    console.warn('Unknown fnparam base_type', type.name, type);
                    return;
            }
        }

        function handleEnumerationType(type) {
            checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ON_CONDITION(${jsClassName}, ${fn.name}, ${ix-1}, number, (args_count == ${params.length - 1}));`);
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
                checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ON_CONDITION(${jsClassName}, ${fn.name}, ${ix-1}, string, (args_count == ${params.length - 1}));`);

                casting.push(`jerry_size_t szArg${ix-1} = jerry_get_string_size(args[${ix-1}]);`);
                casting.push(`jerry_char_t *sArg${ix-1} = (jerry_char_t*) calloc(szArg${ix-1} + 1, sizeof(jerry_char_t));`);
                casting.push(`jerry_string_to_char_buffer(args[${ix-1}], sArg${ix-1}, szArg${ix-1});`);
                casting.push(`string arg${ix-1}((const char*) sArg${ix-1});`);
            }
            else {
                checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ON_CONDITION(${jsClassName}, ${fn.name}, ${ix-1}, object, (args_count == ${params.length - 1}));`);

                casting.push(`uintptr_t arg${ix-1}_native_handle;`);
                casting.push(`jerry_get_object_native_handle(args[${ix-1}], &arg${ix-1}_native_handle);`);
                casting.push(`${cppType} arg${ix-1} = *((${cppType}*)arg${ix-1}_native_handle);`);
            }
        }

        function handleTypedef(type) {
            if (type.tag === 'enumeration_type') {
                handleEnumerationType(type);
            }
            else if (type.tag === 'base_type') {
                handleBaseType(type);
            }
            else if (type.tag === 'class_type' || type.tag === 'structure_type') {
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
            }
        }

        function handlePointerType(type) {
            if (cppType === 'const char*') {
                checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ON_CONDITION(${jsClassName}, ${fn.name}, ${ix-1}, string, (args_count == ${params.length - 1}));`);

                casting.push(`jerry_size_t szArg${ix-1} = jerry_get_string_size(args[${ix-1}]);`);
                casting.push(`jerry_char_t *sArg${ix-1} = (jerry_char_t*) calloc(szArg${ix-1} + 1, sizeof(jerry_char_t));`);
                casting.push(`jerry_string_to_char_buffer(args[${ix-1}], sArg${ix-1}, szArg${ix-1});`);
                casting.push(`${cppType} arg${ix-1} = (${cppType}) sArg${ix-1};`);
            }
            else {
                checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ON_CONDITION(${jsClassName}, ${fn.name}, ${ix-1}, object, (args_count == ${params.length - 1}));`);

                casting.push(`uintptr_t arg${ix-1}_native_handle;`);
                casting.push(`jerry_get_object_native_handle(args[${ix-1}], &arg${ix-1}_native_handle);`);
                casting.push(`${cppType} arg${ix-1} = (${cppType})arg${ix-1}_native_handle;`);
            }
        }

        switch (p.type.tag) {
            case 'base_type':
                handleBaseType(p.type);
                break;
            case 'class_type':
            case 'structure_type':
                handleClassType(p.type);
                break;
            case 'typedef':
                handleTypedef(p.type.type);
                break;
            case 'pointer_type':
                handlePointerType(p.type);
                break;
            case 'reference_type':
                if (p.type.type.tag === 'class_type' || p.type.type.tag === 'structure_type') {
                    handleClassType(p.type.type);
                }
                else if (p.type.type.tag === 'typedef') {
                    if (p.type.type.name && !p.type.type.type.name) {
                        p.type.type.type.name = p.type.type.name;
                    }
                    handleTypedef(p.type.type);
                }
                else if (p.type.type.tag === 'base_type') {
                    handleBaseType(p.type.type);
                }
                else {
                    console.warn('Unknown fnparam reference_type', p.type.type.tag, p.type);
                }
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

    let text;

    if (!isCtor) {
        text = createMemberFunction(obj, jsClassName, fn, params, typeCheckString, castString, argString);
    }
    else {
        fn.name = obj.name; // restore state

        text = createConstructor(obj, jsClassName, fn, params, typeCheckString, castString, argString, allFns);
    }

    return {
        isConstructor: isCtor,
        name: isCtor ? 'ctor' : fn.name,
        argsLength: params.length - 1,
        body: text
    };
};

module.exports = {
    fnToString: fnToString,
    createDestructor: createDestructor,
    createNativeWrapper: createNativeWrapper,
    isConstructor: isConstructor
};
