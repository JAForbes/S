import * as S from './index.js'

import * as U from './utils.js'

type Unnest<T> = T extends Array<any> ? T[number] : never;

type Store<T> = {
	sample(): T;
	sampleAll(): T[];
	read(): T;
	readAll(): T[];
	setState(f: (row?: T) => T): void;
	getReadStream: () => S.Computation<T[]>;
	focus<U>(
		get: (row: T) => U[] | [],
		set: (state: T, update: ( (row:U) => U) ) => T,
		...dependencies: S.Computation<any>[]
	): Store<U>;

	prop<K extends keyof T>(key: K): Store<T[K]>,
	unnest: () => Store<Unnest<T>>,
	
	where: typeof where;

	// whereUnnested: ReturnType<Store<T>["unnest"]>["where"]
	whereUnnested: typeof whereUnnested

	filter( f: ( (row:T) => boolean) ): Store<T>
};

type NotifyMap<T> = WeakMap<Store<T>, (
	(f: ((row:T) => T)) => void
)>;

const notify: NotifyMap<any> = new WeakMap();

const Instances: Map<string, Store<any>> = new Map()

function prop<T, K extends keyof T>(this: Store<T>, key: keyof T) : Store<T[K]> {
	return createChildStore(row => [row[key]], (parent, update) => ({ ...parent, [key]: update(parent[key])}), this) as Store<T[K]>;
}
function unnest<T>(this: Store<T>){
	return createChildStore(
		arrayRow => (arrayRow as any[]),
		(arrayRow, update) => (arrayRow as any[]).map( unnestedRow => update(unnestedRow) ) as T,
		this,
	)
}

function filter<T>(this: Store<T>, f: (row:T) => boolean) {
	return createChildStore(
		row => f(row) ? [row] : [],
		(row, update) => (f(row) ? update(row) : row ),
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
		row => Object.entries(anyRecord).flatMap(
				([k,v]) => (row as any)[k] === v() ? [row] : []
		) as any,
		(row, update) => {
			if ( 
				Object.entries(anyRecord).every(
					([k,v]) => (row as any)[k] === v()
				)	
			) {
				return update(row as any) as any as T
			}
			return row
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
		arrayRow => (arrayRow as any[]).filter( unnestedRow =>  
			Object.entries(anyRecord).every(
				([k,v]) => unnestedRow[k] === v()
			)
		) as any,
		(arrayRow, update) => (arrayRow as any[]).map( unnestedRow => 
			Object.entries(anyRecord).every(
				([k,v]) => unnestedRow[k] === v()
			)
			? update(unnestedRow)
			: unnestedRow
		) as any,
		this,
	)
}

function focus<T, U> (
	this: Store<T>
	, getter: (row: T) => U[] | []
	, setter: (state: T, update: ( (row:U) => U) ) => T
)  {
	return createChildStore(getter, setter, this);
}

export function createStore<T>(table: T[]): Store<T> {
	const stateStream = S.data(table);
	
	const setState: Store<T>["setState"] = (f) => {
		stateStream(S.sample(stateStream).map( row => f(row) ))
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
				row => f(row)
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
		U.map( (results) => {
			return results.flatMap( row => getter(row) )
		}, parentStore.getReadStream()),
		(tableA, tableB) => tableA.length === tableB.length	&& tableA.every( (rowA,i) => rowA === tableB[i])
	);

	const setState = (f: (row?: Child) => Child) => {
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