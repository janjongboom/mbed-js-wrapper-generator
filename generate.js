const fs = require('fs');
const Path = require('path');
const objdumpParser = require('./wrapper-generator/objdump-parser');
const fnToWrapper = require('./wrapper-generator/function-to-wrapper');

let symbolsFile = process.argv[2];
let className = process.argv[3];
let jsClassName = className;

let jsClassIx = process.argv.indexOf('--js-class-name');
if (jsClassIx !== -1) {
    jsClassName = process.argv[jsClassIx + 1];
}

let libraryName = jsClassName.toLowerCase();
let libNameIx = process.argv.indexOf('--library-name');
if (libNameIx !== -1) {
    libraryName = process.argv[libNameIx + 1];
}

if (className === jsClassName && className.indexOf('<') > -1) {
    console.error('When passing in a generic classname, please also pass in --js-class-name');
    console.error('Usage: node generate.js symbolsfile.txt classname [--js-class-name output-classname --library-name lib-name]');
    process.exit(1);
}

if (!symbolsFile || !className) {
    console.error('Usage: node generate.js symbolsfile.txt classname [--js-class-name output-classname --library-name lib-name]');
    process.exit(1);
}

let symbols = fs.readFileSync(symbolsFile, 'utf-8');
let tree = objdumpParser(symbols);

let obj = tree.findClassByName(className);
if (!obj) {
    console.error(`Could not find object '${className}'. Are you sure it's linked in?`);
    process.exit(1);
}

try {
    fs.mkdirSync(Path.join(__dirname, 'output'));
}
catch (ex) {}

let folder = Path.join(__dirname, 'output', 'jerryscript-mbed-' + libraryName + '-' + Date.now());
fs.mkdirSync(folder);
fs.mkdirSync(Path.join(folder, 'mbed-js-' + libraryName));
fs.mkdirSync(Path.join(folder, 'source'));

// Create the base files (-js.h and lib_*.h)
fs.writeFileSync(Path.join(folder, 'mbed-js-' + libraryName, 'mbed-js-' + jsClassName.toLowerCase() + '.h'), createJsH(libraryName, className, jsClassName), 'utf-8');
fs.writeFileSync(Path.join(folder, 'mbed-js-' + libraryName, 'mbed-js-' + libraryName + '-lib.h'), createLibH(libraryName, className, jsClassName), 'utf-8');

// Now we can do interesting stuff...
let fns = tree.getPublicFunctionsFromClass(obj);

let members = fns.filter(fn => !fnToWrapper.isConstructor(obj, fn))
    .map(fn => fnToWrapper.fnToString(obj, jsClassName, fn, fns))
    .filter(fn => !!fn);

let ctors = fns.filter(fn => fnToWrapper.isConstructor(obj, fn))
    .map(fn => fnToWrapper.fnToString(obj, jsClassName, fn, fns));

let enums = (members.concat(ctors))
    .reduce((curr, m) => curr.concat(m && m.enums), [])
    .reduce((curr, e) => {
        if (!e) return curr;

        curr[e.name] = e.values;
        return curr;
    }, {});

let text = (members.concat(ctors)).reduce((curr, m) => curr.concat(m && m.text), []).join('\n\n');

fs.writeFileSync(Path.join(folder, 'source', 'mbed-js-' + jsClassName.toLowerCase() + '.cpp'), createCpp(libraryName, className, jsClassName, text, enums), 'utf-8');

fs.writeFileSync(Path.join(folder, 'mbedjs.json'), createMbedJsJson(libraryName, className, jsClassName), 'utf-8');
fs.writeFileSync(Path.join(folder, 'package.json'), createPackageJson(libraryName, className, jsClassName), 'utf-8');

console.log('Done', folder);
console.log('Do not forget to add \'mbed-js-' + libraryName + '\' to your package.json dependencies');

function createJsH(libraryName, className) {
    let upper = libraryName.toUpperCase();
    return `/* Generated by https://github.com/janjongboom/mbed-js-wrapper-generator */

#ifndef _JERRYSCRIPT_MBED_${upper}_H
#define _JERRYSCRIPT_MBED_${upper}_H

#include "jerryscript-mbed-library-registry/wrap_tools.h"

// @todo: add a reference to the ${className} header here

DECLARE_CLASS_CONSTRUCTOR(${jsClassName});
jerry_value_t mbed_js_wrap_native_object(${className}* ptr);

#endif // _JERRYSCRIPT_MBED_${upper}_H
`;
}

function createLibH(libraryName, className, jsClassName) {
    let upper = libraryName.toUpperCase();

    return `/* Generated by https://github.com/janjongboom/mbed-js-wrapper-generator */

#ifndef _JERRYSCRIPT_MBED_LIB_${upper}_H
#define _JERRYSCRIPT_MBED_LIB_${upper}_H

#include "mbed-js-${libraryName}/mbed-js-${libraryName}.h"
#include "jerryscript-mbed-library-registry/wrap_tools.h"

void mbed_js_${jsClassName}_setup();

DECLARE_JS_WRAPPER_REGISTRATION (${libraryName})
{
    REGISTER_CLASS_CONSTRUCTOR(${jsClassName});
    mbed_js_${jsClassName}_setup();
}

#endif // _JERRYSCRIPT_MBED_LIB_${upper}_H
`;
}

function createCpp(libraryName, className, jsClassName, code, enums) {
    let enumText = Object.keys(enums).map((name, ix) => {
        let values = enums[name];

        let decl = values.map(v => {
            return `jerry_set_property(enum_obj, jerry_create_string((const jerry_char_t*)"${v}"), jerry_create_number((double) ${v}));`
        }).map(v => '        ' + v).join('\n');

        let text = `
    {
        jerry_value_t enum_obj = jerry_create_object();

        jerry_value_t enum_val;
        jerry_value_t enum_key;

${decl}

        jerry_value_t global_obj = jerry_get_global_object();
        jerry_set_property(global_obj, jerry_create_string((const jerry_char_t*)"${name}"), enum_obj);
    }`;

        return text;
    }).join('\n\n');

    return `/* Generated by https://github.com/janjongboom/mbed-js-wrapper-generator */

#include "jerryscript-mbed-util/logging.h"
#include "jerryscript-mbed-library-registry/wrap_tools.h"

// @todo: add a reference to the ${className} header here

${code}

void mbed_js_${jsClassName}_setup() {
${enumText}
}
`;
}

function createMbedJsJson(libraryName, className, jsClassName) {
return `{
    "source": [
        "."
    ],
    "includes": [
        "mbed-js-${libraryName}/mbed-js-${libraryName}-lib.h"
	],
    "name": "${libraryName}"
}
`;
}

function createPackageJson(libraryName, className, jsClassName) {
return `{
    "name": "mbed-js-${libraryName}",
    "version": "1.0.0"
}
`;
}
