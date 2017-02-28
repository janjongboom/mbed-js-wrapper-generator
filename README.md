# mbed JerryScript wrapper generator

Generates C++/JS wrappers for JavaScript on mbed. This makes it easy to consume C++ APIs from JerryScript.

* [Example of a simple library](https://github.com/janjongboom/mbed-js-chainableled).
* [Example of a more complex library with multiple objects](https://github.com/janjongboom/mbed-js-http).

## How to generate a wrapper

1. Create a C++ application that uses the library - f.e. the example program that comes with the library.
1. Produce a debug build via:

    ```
    $ mbed compile --profile ./mbed-os/tools/profiles/debug.json
    ```

1. Go to the build directory and run an object dump:

    ```
    $ arm-none-eabi-objdump -Wi -g *.elf > symbols.txt
    ```

1. Run this tool to generate the wrapper (where ClassName is the name of the object you want to wrap):

    ```
    $ node generate.js symbols.txt ClassName
    ```

## How to use a wrapper

This instructions only work for projects that build via Gulp. See [mbed-js-example](https://github.com/ARMmbed/mbed-js-example).

1. Copy the folder with the wrapper to your mbed-js project.
1. Create a symlink into the node_modules folder, via:

    ```
    $ ln -s $PWD/mbed-js-classname node_modules/mbed-js-classname
    ```

1. In the package.json of your mbed-js project, add the library to the `dependencies` list:

    ```
    "dependencies": {
        "mbed-js-classname": "~1.0.0"
    },
    ```

1. Compile the project with Gulp.

    ```
    $ gulp --target=K64F
    ```

## Caveats / tips

* C++ APIs often look different than a JS API, passing in a pointer and the number of elements. This requires manual work.
* Higher-level APIs work better than lower-level APIs. F.e. on C++ level use a `string` rather than a `char*`. Same goes for arrays.
* If you want to have a function in JavaScript that then returns another object (rather than a primitive):
    1. Create wrappers for both objects (with `--library-name samelibname` parameter).
    1. Make a shared `.lib` file (rather than 2 separate ones) where you declare both objects.
    1. Include the `mbed-js-childname.h` header in your parent implementation (to expose the `mbed_js_wrap_native_object` function).
    1. Probably remove the ctor for the child, unless you want JS users to be able to construct their own versions.
    1. That's it!
* Enums are automatically exposed under the name of the C++ object that declared them (see the `_setup` calls). F.e.:

    ```cpp
    typedef enum { HTTP_GET } http_method;
    ```

    Becomes:

    ```js
    http_method.HTTP_GET
    ```
* Templated functions require the `--js-class-name` parameter to be set.

    ```
    $ node generate.js mqtt-symbols.txt "Client<MQTTNetwork, Countdown, 100, 5>" --js-class-name MqqtClient
    ```

## Todo

* `Callback<>` types. There is `mbed::js::EventLoop::getInstance().wrapFunction`, but it does not handle arguments.
* vector / array types.
* Optional parameters / function overloads.
* C++ APIs are often synchronous. Should have an easy method to make them async (by waiting on an RTOS thread).
* A whole bunch of primitives are not implemented yet.

## Todo (but not sure if possible)

* Include the header file where the native object is declared. This info does not seem to be in the `.elf` file.
