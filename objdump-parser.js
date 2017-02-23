const fs = require('fs');

// super memory efficient, oh wait...
let raw = fs.readFileSync('symbols.txt', 'utf-8').split('\n');

console.log('lines', raw.length);

let tree = {
    level: -1,
    children: []
};

let leaf = {
    level: 0,
    parent: tree,
    children: []
};

let allNodes = [];

for (let ix = 0; ix < raw.length; ix++) {
    let line = raw[ix];

    if (line.indexOf(' <') === 0) {
        let symbol = parseSymbol(ix);
        if (!symbol) continue;

        symbol.children = [];

        // console.log('symbol.level %d, leaf.level %d', symbol.level, leaf.level);

        if (symbol.level === leaf.level) {
            symbol.parent = leaf.parent;

            leaf.parent.children.push(symbol);
        }

        else if (symbol.level - leaf.level === 1 /* 1 up */) {
            symbol.parent = leaf;

            leaf.children.push(symbol);
        }

        else if (symbol.level < leaf.level /* down */) {
            let parent = leaf.parent;

            for (let i = 0; i < leaf.level - symbol.level; i++) {
                parent = parent.parent;
            }

            symbol.parent = parent;

            parent.children.push(symbol);
        }

        else {
            console.warn('symbol.level %d, leaf.level %d', symbol.level, leaf.level);
            continue;
        }

        allNodes.push(symbol);

        leaf = symbol;

        if (line.indexOf('DW_TAG_class_type') > 0) {
            // console.log(symbol);
        }
    }
}

let lookupByAddress = allNodes.reduce((curr, node) => {
    curr[node.address] = node;
    return curr;
}, {});

// remove the parents so we can print it
console.log('removeparents');
removeParents(tree);

console.log('Expanding types');
// expand all types
allNodes.forEach(n => expandType(n));
console.log('Done expanding');

let https = allNodes.filter(n => n.tag === 'class_type' && n.name === 'HttpsRequest')[0];

// functions have tag 'subprogram' and accessibility '1\t(public)'
let fns = https.children.filter(c => c.tag === 'subprogram' && c.accessibility === '1\t(public)');

for (let fn of fns) {
    console.log('======================================');
    console.log(fn.name);
    if (fn.type) {
        console.log('Return type: ', cloneAndRemoveChildren(fn.type));
    }
    else {
        console.log('Return type: None');
    }

    let ix = 0;
    for (let param of fn.children.filter(c => c.tag === 'formal_parameter')) {
        console.log(`arg${ix++}`, cloneAndRemoveChildren(param.type));
    }
    console.log('\n\n');
}

// console.log('Done', fns[0]);

function cloneAndRemoveChildren(node, depth) {
    depth = depth || 5;

    let newnode = {};
    for (let key of Object.keys(node)) {
        if (key === 'children' || key === 'type') {
            continue;
        }

        newnode[key] = node[key];
    }

    if (node.type && depth-- >= 0) {
        newnode.type = cloneAndRemoveChildren(node.type, depth);
    }

    return newnode;
}

function expandType(node) {
    if (node.type && typeof node.type === 'string') {
        let m = node.type.match(/^\<0x(.[^\>]+)>/);
        if (!m) return;

        let tn = m[1];
        node.type = lookupByAddress[tn];
    }
}

function removeParents(node) {
    delete node.parent;
    node.children.forEach(c => {
        removeParents(c);
    });
}

function parseSymbol(ix) {
    let firstLine = raw[ix];

    let parsedFirst = firstLine.match(/\s\<(\d)\>\<([a-z0-9]+)\>\: Abbrev Number\: ([0-9]+) \(DW_TAG_(.[^\)]+)\)/);
    if (!parsedFirst) {
        if (firstLine.indexOf('Abbrev Number: 0') > -1) {
            return;
        }
        console.log('Cannot parse line...', firstLine);
    }

    let obj = {
        level: Number(parsedFirst[1]),
        address: parsedFirst[2],
        abbrev: Number(parsedFirst[3]),
        tag: parsedFirst[4],
    };

    while (raw[++ix].indexOf('    <') === 0) {
        let line = raw[ix];
        let parsed = line.match(/.*?\<([a-z0-9]+)\>\s*DW_AT_(\w+)\s*\:\s*(.+)/)
        if (!parsed) {
            console.log(line);
            continue;
        }

        if (parsed[2] === 'name') {
            obj.fullName = parsed[3].trim();
            obj.name = (parsed[3].trim().match(/\(.[^\)]+\)\: (.+)/) || [null, parsed[3].trim()])[1];
        }
        else {
            obj[parsed[2]] = parsed[3].trim();
        }
    }

    return obj;


    //  <2><b92b9>: Abbrev Number: 137 (DW_TAG_formal_parameter)
}

