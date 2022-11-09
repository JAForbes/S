import * as S from './index.js'

const map = <T,U>(f: ((x:T) => U), computation: S.Computation<T>) => S.computation(() => {
	return f( computation() )
}, f(S.sample(computation)))

const dropRepeatsWith = <T>(signal: S.Computation<T>, equality: (a: T, b: T) => boolean) => {
	let out = S.data( S.sample(signal) )
	let i = 0
	S.computation<T>((prev) => {
		let next = signal()

		if ( i > 0 && !equality(prev, next) ) {
			out(next)
		}
		i++
		return next
	})
	return out;
}

const mergeAll = <T>(computations: S.Computation<T>[]) : S.Computation<T[]> => {
	
	let initial = computations.map( x => S.sample(x)! )

	let out = S.computation(() => {
		return computations.map( x => x() )
	}, initial)

	return out
}

type Store<T> = {
	sample(): T;
	sampleAll(): T[];
	read(): T;
	readAll(): T[];
	setState(f: (x?: T) => T): void;
	getReadStream: () => S.Computation<T[]>;
	focus<U>(
		get: (x: T) => U[] | [],
		set: (state: T, update: ( (x:U) => U) ) => T,
		...dependencies: S.Computation<any>[]
	): Store<U>;
};

type NotifyMap<T> = WeakMap<Store<T>, (
	(f: ((x:T) => T)) => void
)>;
const notify: NotifyMap<any> = new WeakMap();

export function createStore<T>(xs: T[]): Store<T> {
	const stateStream = S.data(xs);

	const setState: Store<T>["setState"] = (f) => {
		stateStream(S.sample(stateStream).map( x => f(x) ))
	};

	const focus: Store<T>["focus"] = (getter, setter) => {
		return createChildStore(getter, setter, store, []);
	};

	let store: Store<T> = {
		sample: () => S.sample(stateStream)[0],
		sampleAll: () => S.sample(stateStream),
		setState,
		read: () => stateStream()[0],
		readAll: () => stateStream(),
		getReadStream: () => stateStream,
		focus,
	};

	notify.set(store, (f) => {
		stateStream( 
			S.sample(stateStream).map( 
				x => f(x)
			)
		);
	});

	return store;
}

function createChildStore<Parent, Child>(
	getter: (parent: Parent) => Child[],
	setter: (parent: Parent, update: (x?:Child) => Child ) => Parent,
	parentStore: Store<Parent>,
	dependencies: S.Computation<any>[]
): Store<Child> {
	const allDependencies$ = mergeAll([parentStore.getReadStream(), ...dependencies]) as S.Computation<[Parent[], ...any[]]>;
	const read$ = dropRepeatsWith(
		map( ([xs]) => {
			return xs.flatMap( x => getter(x) )
		}, allDependencies$),
		(xs, ys) => xs.length === ys.length	&& xs.every( (x,i) => x === ys[i])
	);
	const setState = (f: (x?: Child) => Child) => {
		notify.get(parentStore)!(
			(parent: Parent) => setter(parent, f)
		);
	};
	const focus: Store<Child>["focus"] = (getter, setter, ...dependencies) => {
		return createChildStore(getter, setter, store, dependencies);
	};
	let store: Store<Child> = {
		sample: () => S.sample(read$)[0],
		sampleAll: () => S.sample(read$),
		read: () => read$()[0],
		readAll: () => read$(),
		setState,
		getReadStream: () => read$,
		focus,
	};
	notify.set(store, (f) => {
		notify.get(parentStore)!(
			(parent) => setter(parent, f)
		)
	});

	return store;
}

export { root } from './index.js'