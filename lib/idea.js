function analyze(visitor) {
  let path = [];
  let staticPath = [];
  function PathProxy(target = () => {}) {
    let currentProxy = new Proxy(target, {
      get(_, key, __) {
        if (key === Symbol.toPrimitive) return () => NaN;

        const callable = (...args) => {
          path[path.length - 1] = {
            tag: "apply",
            name: key,
            args,
            prevProxy: currentProxy,
          };

          return PathProxy();
        };

        path.push({ tag: "get", name: key, prevProxy: currentProxy });
        staticPath.push({ tag: "get", name: key, prevProxy: currentProxy });

        return PathProxy(callable);
      },
    });

    return currentProxy;
  }

  const proxy = PathProxy();

  visitor(proxy);

  return {
    path,
    staticPath,
  };
}

let { path, staticPath } = analyze((xs) =>
  xs
    .filter((x) => x.id == 4) // *.id
		.filter( x => x.friends.filter( x => x.color == 'blue' ? x.blueFriends : x.redFriends ) )
    .flatMap( (x) => x.friends ) // *.friends.*
    .find( (x) => x.status == "online" ) // *.friends.*.status
		.map( (x) => x.avatar ) // *.friends.*.avatar
		.map( (x) => x.url ) // *.friends.*.avatar.url
);

let stack = path.slice();

let dependencies = new Set();
let prevDep = [];

// need to recurse or push/pop when calling sub functions
// e.g. if someone maps inside a map, or filters within a map
// also need to resolve real values when running the visitors to handle
// conditional dependencies, and re-compute dependencies when
// the value changes in true S style
while (stack.length) {
  let next = stack.shift();

  if (next.tag === "get") {
    prevDep.push(next.name);
    dependencies.add(prevDep);
  } else if (next.name === "map") {
    let [fn] = next.args;

    let { path, staticPath } = analyze(fn);
		let prefix = []
		for( let sp of staticPath ) {
			prefix.push(sp.name)

			dependencies.add(
				prevDep.concat( prefix ).join('.')
			)
		}

		prevDep.push(...prefix)
  } else if (next.name === "flatMap") {
    let [fn] = next.args;

    let { path, staticPath } = analyze(fn);
	
		let prefix = ['*']
		for( let sp of staticPath ) {
			prefix.push(sp.name)

			dependencies.add(
				prevDep.concat(prefix).join('.')
			)
		}
		prevDep.push(...prefix, '*')
  } else if (next.name === "find") {
    let [fn] = next.args;

    let { path, staticPath } = analyze(fn);

		let prefix = []
		for( let sp of staticPath ) {
			prefix.push(sp.name)

			dependencies.add(
				prevDep.concat(prefix).join('.')
			)
		}
  }else if (next.name === "filter") {
    let [fn] = next.args;

    let { path, staticPath } = analyze(fn);
		let prefix = ['*']
		for( let sp of staticPath ) {
			prefix.push(sp.name)

			dependencies.add(
				prevDep.concat(prefix).join('.')
			)
		}
  }
}

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
console.log(dependencies);
