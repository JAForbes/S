let raw = Symbol.for("JAForbes/S::raw");

const existingPaths = new Map();


/**
 * Need an immutable complex representation of paths
 * so we don't have to stringify everything just to
 * use sets
 */
class Path {
  __items = [];
  static empty(){
    return existingPaths.get('')
  }
  at(i) {
    return this.__items.at(i)
  }
  concat(...items) {
    let proposal = this.__items.concat(items)
    let representation = proposal.join(".");
    if (existingPaths.has(representation)) {
      return existingPaths.get(representation);
    }
    let pathObject = new Path()
    pathObject.__items = proposal
    existingPaths.set(representation, pathObject)
    return pathObject
  }
  slice(){
    return this.__items.slice()
  }
  toString(){
    return this.__items.join('.')
  }
}
existingPaths.set('', new Path())

class PathItem {}
class PathGet extends PathItem {
  tag = 'get'
  constructor({ key }) {
    super();
    this.key = key;
  }
  toString() {
    return "get(" + this.key + ")";
  }
}

// represents a list or object traversal
// so users.map( x => x.name ) is differentiate from users.name
// the former is a traversal, the latter is a field on the array/object itself
class PathMap extends PathItem {
  tag = 'map'
  constructor() {
    super();
  }
  toString() {
    return "[*]";
  }
}

class PathFlatMap extends PathItem {
  tag = 'flatMap'
  constructor() {
    super();
  }
  toString() {
    return "[**]";
  }
}

class PathApply extends PathItem {
  tag = 'apply'
  constructor({ key, args }) {
    super();
    this.key = key;
    this.args = args;
  }
  toString() {
    return "apply(" + this.key + ", args(" + this.args + "))";
  }
}

function analyze(visitor, input=PathProxy()) {
  function PathProxy({ path = Path.empty(), staticPath = Path.empty(), target = () => {} } = {}) {
    let currentProxy = new Proxy(target, {
      get(_, key, __) {
        // for now just return NaN for value comparisons
        if (key === Symbol.toPrimitive) return () => NaN;
        if (key === raw) return { path, staticPath };

        const callable = (...args) => {
          let nextPath = path.concat( new PathApply({ key, args }) );

          return PathProxy({
            path: nextPath,
            staticPath,
          });
        };

        let nextPath = path.concat( new PathGet({ key }) );
        let nextStaticPath = staticPath.concat(nextPath.at(-1));

        return PathProxy({
          target: callable,
          path: nextPath,
          staticPath: nextStaticPath,
        });
      },
    });

    return currentProxy;
  }


  let returned = visitor(input);

  let pathData = returned[raw];
  if ( pathData ) {
    return { tag: 'proxy', value: { returned, ...returned[raw] } }
  } else {
    return { tag: 'unknown', value: returned }
  }
}

// if the previous item is a Get
// and this item is a Map or FlatMap
// we know its a list
// we don't care what ops they do, just what
// the final resolved path is, and that includes
// whether or not something is a property access
// or a field accessed within a list
let { value: { path, staticPath } } = analyze(
  (xs) =>
    xs
      .map((x) => x.a)
      .map((x) => x.b)
      .map((x) => x.c)
      .flatMap((x) => x.items.map((x) => x.lines))
      .map((x) => x.cost)
      .flatMap((x) => {
        x.irrelevant;
        return x.relevant.map((x) => x.info);
      })
  // xs
  //   .filter((x) => x.id == 4) // *.id
  // 	// .filter( x => x.friends.filter( x => x.color == 'blue' ? x.blueFriends : x.redFriends ) )
  //   .filter( x => x.a.b.c.d.friends.filter( x => x.color == 'blue' ? x.blueFriends : x.redFriends ) )
  //   .flatMap( (x) => x.friends ) // *.friends.*
  //   .find( (x) => x.status == "online" ) // *.friends.*.status
  // 	.map( (x) => x.avatar ) // *.friends.*.avatar
  // 	.map( (x) => x.url ) // *.friends.*.avatar.url
);

let stack = path.slice();

let dependencies = new Set();

// detects all referenced states
// but doesn't handle nested invocations yet
// Set(6) {
//   '*.id',
//   '*.friends',
//   '*.friends.filter',
//   '*.friends.*.status',
//   '*.friends.*.avatar',
//   '*.friends.*.avatar.url'
// }

function f({ prefix, stack, dependencies }) {
  let additions = [];
  for (let item of stack) {
    if (item.tag === "get") {
      prefix.push(item);
      additions.push(item);
      dependencies.add(prefix);
    } else if (item.tag === "apply" && typeof item.args[0] === "function") {
      let fn = item.args[0];

      let analyzed = analyze(fn);
      if ( analyzed.tag === 'unknown' ) continue;
      let { path } = analyzed

      const childPrefix =
        item.key === "map" && !(prefix.at(-1) instanceof PathFlatMap)
          ? [new PathMap()]
          : item.key === "flatMap"
          ? [new PathMap()]
          : [];
      let realised = f({
        prefix: prefix.concat(childPrefix),
        stack: path.slice(),
        dependencies,
      });

      if (item.key === "map") {
        prefix.push(...childPrefix, ...staticPath.slice());
        additions.push(...childPrefix, ...staticPath.slice());
      } else if (item.key === "flatMap") {
        prefix.push(...childPrefix, ...realised.additions, new PathMap());
        additions.push(...childPrefix, ...realised.additions, new PathMap());
      }
    }
  }
  return { prefix, additions };
}

function simplify(path){

  let stack = path.slice()
  let history = []
  let lastMapI = -1
  let lastFlatMapI = -1
  while (stack.length) {
    let next = stack.shift()
    
    // for look behind
    history.push(next)

    if ( next instanceof PathMap ) {
      
      if ( lastMapI > -1 && history.slice(lastMapI+1, -1).every( x => x instanceof PathGet ) ) {
        history.pop()
        continue;  
      } 
      lastMapI = history.length - 1
    } else if ( next instanceof PathFlatMap ) {
      lastFlatMapI = history.length - 1
    }
  }

  return history;
}

let realised = f({ prefix: [], stack, dependencies });
// console.log(dependencies);

for ( let path of [...dependencies] ) {
  dependencies.delete(path)
  dependencies.add( simplify(path) )
  
}

void 0;

var a = Path.empty().concat( new PathGet({ key: 'a' }), new PathApply({ key: 'filter', args: [x => x.a > 5]}) )
var b = Path.empty().concat( new PathGet({ key: 'a' }), new PathApply({ key: 'filter', args: [x => x.a > 5]}) )
var c = Path.empty().concat( new PathGet({ key: 'a' }), new PathApply({ key: 'filter', args: [x => x.a > 6]}) )
void 0;

console.log('hello')
