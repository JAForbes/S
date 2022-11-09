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

type Unnest<T> = T extends Array<any> ? T[number] : never;

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

	prop<K extends keyof T>(key: K): Store<T[K]>,
	unnest: () => Store<Unnest<T>>,
	
	where<
		K extends keyof T,
		V extends T[K],
		R extends Partial<Record<K, S.Computation<V>>>
	>(
		record: R
	): Store<T>

	whereItemEq: ReturnType<Store<T>["unnest"]>["where"]

	filter( f: ( (x:T) => boolean) ): Store<T>
};

type NotifyMap<T> = WeakMap<Store<T>, (
	(f: ((x:T) => T)) => void
)>;
const notify: NotifyMap<any> = new WeakMap();


const prop_ = <T> (store: Store<T>) => (key: keyof T) => {
	return createChildStore(x => [x[key]], (parent, update) => ({ ...parent, [key]: update(parent[key])}), store, []);
};

const unnest_ = <T>(store: Store<T>) => () => {
	return createChildStore(
		xs => (xs as any[]),
		(list, update) => (list as any[]).map( x => update(x) ) as T,
		store,
		[]
	)
}

const filter_ = <T>(store: Store<T>) => (f: (x:T) => boolean) => {
	return createChildStore(
		x => f(x) ? [x] : [],
		(x, update) => (f(x) ? update(x) : x ),
		store,
		[]
	)
}
const where_ = <T>(store: Store<T>) => (record: Record<keyof T, T[keyof T]>) => {
	const anyRecord = record as Record<string, any>;
	return createChildStore(
		x => Object.entries(anyRecord).flatMap(
				([k,v]) => (x as any)[k] === v() ? [x] : []
		) as any,
		(object, update) => {
			if ( 
				Object.entries(anyRecord).every(
					([k,v]) => (object as any)[k] === v()
				)	
			) {
				return update(object as any) as any as T
			}
			return object
		},
		store,
		[]
	)
}

const whereItemEq_ = <T>(store: Store<T>) => (record: Record<keyof T, T[keyof T]>) => {

	const anyRecord = record as Record<string, any>;
	return createChildStore(
		xs => (xs as any[]).filter( x =>  
			Object.entries(anyRecord).every(
				([k,v]) => x[k] === v()
			)
		) as any,
		(list, update) => (list as any[]).map( x => 
			Object.entries(anyRecord).every(
				([k,v]) => x[k] === v()
			)
			? update(x)
			: x
		) as any,
		store,
		[]
	)
}


export function createStore<T>(xs: T[]): Store<T> {
	const stateStream = S.data(xs);
	
	const setState: Store<T>["setState"] = (f) => {
		stateStream(S.sample(stateStream).map( x => f(x) ))
	};

	const focus: Store<T>["focus"] = (getter, setter) => {
		return createChildStore(getter, setter, store, []);
	};

	let incompleteStore = {
		sample: () => S.sample(stateStream)[0],
		sampleAll: () => S.sample(stateStream),
		setState,
		read: () => stateStream()[0],
		readAll: () => stateStream(),
		getReadStream: () => stateStream,
		focus,
	};

	let store = Object.assign(incompleteStore as Store<T>, {
		prop: prop_(incompleteStore as Store<T>),
		where: where_(incompleteStore as Store<T>),
		whereItemEq: whereItemEq_(incompleteStore as Store<T>),
		unnest: unnest_(incompleteStore as Store<T>),
		filter: filter_(incompleteStore as Store<T>),
	})

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
	const prop: Store<Child>["prop"] = (key) => {
		return createChildStore(x => [x[key]], (parent, update) => ({ ...parent, [key]: update(parent[key])}), store, []);
	};
	let incompleteStore = {
		sample: () => S.sample(read$)[0],
		sampleAll: () => S.sample(read$),
		read: () => read$()[0],
		readAll: () => read$(),
		setState,
		getReadStream: () => read$,
		focus,
		prop,
	};

	let store = Object.assign(incompleteStore as Store<Child>, {
		prop: prop_(incompleteStore as Store<Child>),
		where: where_(incompleteStore as Store<Child>),
		whereItemEq: whereItemEq_(incompleteStore as Store<Child>),
		unnest: unnest_(incompleteStore as Store<Child>),
		filter: filter_(incompleteStore as Store<Child>),
	}) as Store<Child>

	notify.set(store, (f) => {
		notify.get(parentStore)!(
			(parent) => setter(parent, f)
		)
	});

	return store;
}

export { root } from './index.js'