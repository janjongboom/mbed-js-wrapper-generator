# Object dump parser

Generate symbols.txt from .elf file:

```
arm-none-eabi-objdump -Wi -g mbed-os-example-http.elf > symbols.txt
```

Then run:

```
$ node objdump-parser.js > structure.json
```
