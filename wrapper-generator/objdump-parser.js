const fs = require('fs');

function expandType(node, lookupByAddress) {
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

function parseSymbol(raw, ix) {
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
}

function ObjdumpTree(tree, nodes) {
    this.tree = tree;
    this.nodes = nodes;
}

ObjdumpTree.prototype.findClassByName = function(className) {
    return this.nodes.filter(n => n.tag === 'class_type' && n.name === className)[0];
};

ObjdumpTree.prototype.getPublicFunctionsFromClass = function(classNode) {
    return classNode.children.filter(c => c.tag === 'subprogram' && c.accessibility === '1\t(public)');
};

ObjdumpTree.prototype.cloneAndRemoveChildren = function(node, depth) {
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
};

module.exports = function(symbols) {
    let raw = symbols.split('\n');

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
            let symbol = parseSymbol(raw, ix);
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
        }
    }

    let lookupByAddress = allNodes.reduce((curr, node) => {
        curr[node.address] = node;
        return curr;
    }, {});

    // remove the parents so we can print it
    removeParents(tree);

    // expand all types
    allNodes.forEach(n => expandType(n, lookupByAddress));

    return new ObjdumpTree(tree, allNodes);
};
