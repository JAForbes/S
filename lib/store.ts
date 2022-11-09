import * as S from './index.js'

import * as U from './utils.js'

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
	
	where: typeof where;

	// whereUnnested: ReturnType<Store<T>["unnest"]>["where"]
	whereUnnested: typeof whereUnnested

	filter( f: ( (x:T) => boolean) ): Store<T>
};

type NotifyMap<T> = WeakMap<Store<T>, (
	(f: ((x:T) => T)) => void
)>;

const notify: NotifyMap<any> = new WeakMap();

const Instances: Map<string, Store<any>> = new Map()

function prop<T, K extends keyof T>(this: Store<T>, key: keyof T) : Store<T[K]> {
	return createChildStore(x => [x[key]], (parent, update) => ({ ...parent, [key]: update(parent[key])}), this) as Store<T[K]>;
}
function unnest<T>(this: Store<T>){
	return createChildStore(
		xs => (xs as any[]),
		(list, update) => (list as any[]).map( x => update(x) ) as T,
		this,
	)
}

function filter<T>(this: Store<T>, f: (x:T) => boolean) {
	return createChildStore(
		x => f(x) ? [x] : [],
		(x, update) => (f(x) ? update(x) : x ),
		this,
	)
}

function where<
	T,
	K extends keyof T,
	V extends T[K],
	R extends Partial<Record<K, S.Computation<V>>>
>(this: Store<T>, record: R) : Store<T> {
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
		this,
	)
}

function whereUnnested <T, TT extends Unnest<T>, K extends keyof TT, V extends TT[K]>(
	this: Store<T>
	, record: Partial<
		Record<K, S.Computation<V> >
	>
) : Store<Unnest<T>> {

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
		this,
	)
}

function focus<T, U> (
	this: Store<T>
	, getter: (x: T) => U[] | []
	, setter: (state: T, update: ( (x:U) => U) ) => T
)  {
	return createChildStore(getter, setter, this);
}

export function createStore<T>(xs: T[]): Store<T> {
	const stateStream = S.data(xs);
	
	const setState: Store<T>["setState"] = (f) => {
		stateStream(S.sample(stateStream).map( x => f(x) ))
	};

	let store : Store<T> = {
		sample: () => S.sample(stateStream)[0],
		sampleAll: () => S.sample(stateStream),
		setState,
		read: () => stateStream()[0],
		readAll: () => stateStream(),
		getReadStream: () => stateStream,
		focus,
		prop,
		where,
		whereUnnested,
		unnest,
		filter,
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
	parentStore: Store<Parent>
): Store<Child> {

	const read$ = U.dropRepeatsWith(
		U.map( (xs) => {
			return xs.flatMap( x => getter(x) )
		}, parentStore.getReadStream()),
		(xs, ys) => xs.length === ys.length	&& xs.every( (x,i) => x === ys[i])
	);

	const setState = (f: (x?: Child) => Child) => {
		notify.get(parentStore)!(
			(parent: Parent) => setter(parent, f)
		);
	};
	
	let store: Store<Child> = {
		sample: () => S.sample(read$)[0],
		sampleAll: () => S.sample(read$),
		read: () => read$()[0],
		readAll: () => read$(),
		setState,
		getReadStream: () => read$,
		focus,
		prop,
		where,
		whereUnnested,
		unnest,
		filter,
	};

	notify.set(store, (f) => {
		notify.get(parentStore)!(
			(parent) => setter(parent, f)
		)
	});

	return store;
}

export { root } from './index.js'