function getCppType(type) {
    switch (type.tag) {
        case 'base_type':
        case 'typedef':
            return type.name;
        case 'pointer_type':
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

        returnValues.push(`${cppType} native_ptr->${fn.name}(${argString});`);

        switch (fn.type.tag) {
            case 'base_type':
                switch (fn.type.name) {
                    case 'float':
                        returnValues.push(`return jerry_create_number(result);`);
                        break;
                    default:
                        console.warn('Unknown return base_type', fn.type.name, fn.type);
                        return;
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

    let out = `/**
 * ${obj.name}#destructor
 *
 * Called if/when the ${obj.name} is GC'ed.
 */
void NAME_FOR_CLASS_NATIVE_DESTRUCTOR(${obj.name})(const uintptr_t native_handle) {
    delete reinterpret_cast<${obj.name}*>(native_handle);
}

/**
 * ${obj.name} (native JavaScript constructor)
 */
DECLARE_CLASS_CONSTRUCTOR(${obj.name}) {
    CHECK_ARGUMENT_COUNT(${obj.name}, __constructor, (args_count == ${params.length - 1}));
${typeCheckString}

${castString}

    // Create the native object
    uintptr_t native_ptr = (uintptr_t) new ${obj.name}(${argString});

    // create the jerryscript object
    jerry_value_t js_object = jerry_create_object();
    jerry_set_object_native_handle(js_object, native_ptr, NAME_FOR_CLASS_NATIVE_DESTRUCTOR(${obj.name}));

${fnString}

    return js_object;
}`;
    return out;
}

function isMemberFunction(obj, fn) {
    if (fn.name.indexOf('operator') === 0) return false;

    if (obj.name === fn.name && fn.type.tag === 'pointer_type' && fn.type.type === obj) return false;

    let params = fn.children.filter(c => c.tag === 'formal_parameter');
    if (params[0].type.tag !== 'pointer_type' || params[0].type.type !== obj) return false;

    return true;
}

function isConstructor(obj, fn) {
    return obj.name === fn.name && fn.type.tag === 'pointer_type' && fn.type.type === obj;
}

function fnToString(obj, fn, allFns) {
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

    for (let ix = 1; ix < params.length; ix++) {
        let p = params[ix];
        let cppType = getCppType(p.type);
        if (!cppType) return;

        switch (p.type.tag) {
            case 'base_type':
                switch (p.type.name) {
                    case 'float':
                    case 'int':
                        checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ALWAYS(${obj.name}, ${fn.name}, ${ix-1}, number);`);
                        casting.push(`double jArg${ix-1} = jerry_get_number_value(args[${ix-1}]);`);
                        casting.push(`${cppType} arg${ix-1} = static_cast<${cppType}>(jArg${ix-1});`);
                        break;
                    default:
                        console.warn('Unknown base_type', p.type.name, p.type);
                        return;
                }
                break;
            case 'typedef':
                if (p.type.type.tag === 'enumeration_type') {
                    checkArgumentTypes.push(`CHECK_ARGUMENT_TYPE_ALWAYS(${obj.name}, ${fn.name}, ${ix-1}, number);`);
                    casting.push(`${cppType} arg${ix-1} = ${cppType}(jerry_get_number_value(args[${ix-1}]));`)
                }
                else {
                    console.warn('Unknown typedef', p.type.type.tag, p.type);
                    return;
                }
                break;
            default:
                console.warn('Unknown tag', p.type.tag, p.type);
                return;
        }
    }

    let typeCheckString = checkArgumentTypes.map(a => '    ' + a).join('\n');
    let castString = casting.map(a => '    ' + a).join('\n');
    let argString = Array.apply(null, { length: params.length - 1 }).map((v, ix) => 'arg' + ix).join(', ');

    if (!isCtor) {
        return createMemberFunction(obj, fn, params, typeCheckString, castString, argString);
    }
    else {
        fn.name = obj.name; // restore state
        return createConstructor(obj, fn, params, typeCheckString, castString, argString, allFns);
    }
};

module.exports = {
    fnToString: fnToString,
    isConstructor: isConstructor
};
