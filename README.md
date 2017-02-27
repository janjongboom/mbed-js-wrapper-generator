# mbed JerryScript wrapper generator

Generates C++/JS wrappers for JavaScript on mbed. This makes it easy to consume C++ APIs from JerryScript.

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

## Todo

* `Callback<>` types. There is `mbed::js::EventLoop::getInstance().wrapFunction`, but it does not handle arguments.
