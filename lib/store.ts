import * as S from './index.js'

import * as U from './utils.js'

type Unnest<T> = T extends Array<any> ? T[number] : never;

type Store<T> = {
	sample(): T;
	sampleAll(): T[];
	read(): T;
	readAll(): T[];
	setState(f: (row: T) => T): void;
	getReadStream: () => S.Computation<T[]>;
	focus<U>(
		get: (row: T) => U[] | [],
		set: (state: T, update: ( (row:U) => U) ) => T,
	): Store<U>;

	prop<K extends keyof T>(key: K): Store<T[K]>,
	unnest: () => Store<Unnest<T>>,
	
	where: typeof where;

	// whereUnnested: ReturnType<Store<T>["unnest"]>["where"]
	whereUnnested: typeof whereUnnested

	filter( f: ( (row:T) => boolean) ): Store<T>

	path: string[]
};

type NotifyMap<T> = WeakMap<Store<T>, (
	(f: ((row:T) => T)) => void
)>;

const notify: NotifyMap<any> = new WeakMap();

const instances: Map<string, Store<any>> = new Map()

function prop<T, K extends keyof T>(this: Store<T>, key: keyof T) : Store<T[K]> {
	const newPath = this.path.concat(String(key))

	return S.xet(
		instances
		, newPath.join('.')
		, () => createChildStore(
			row => [row[key]]
			, (parent, update) => ({ ...parent, [key]: update(parent[key])})
			, this
			, newPath
		) as Store<T[K]>
	)
	
}
function unnest<T>(this: Store<T>){
	const newPath = this.path.concat('unnest()')

	return S.xet(instances, newPath.join('.'), () => 
		createChildStore(
			arrayRow => (arrayRow as any[]),
			(arrayRow, update) => (arrayRow as any[]).map( unnestedRow => update(unnestedRow) ) as T,
			this,
			newPath
		)
	)
}

function filter<T>(this: Store<T>, f: (row:T) => boolean) {
	const newPath = this.path.concat('filter('+f+')')

	return S.xet( instances, newPath.join('.'), () => 
		createChildStore(
			row => f(row) ? [row] : [],
			(row, update) => (f(row) ? update(row) : row ),
			this,
			newPath
		)
	)
}

function computationToString(s: any){
	const id = S.id(s)
	if (id) {
		return `signal{${id}}`
	}
	return s + ''
}

function where<
	T,
	K extends keyof T,
	V extends T[K],
	R extends Partial<Record<K, S.Computation<V>>>
>(this: Store<T>, record: R) : Store<T> {
	const anyRecord = record as Record<string, any>;
	const newPath = 
		this.path.concat('where({'+Object.entries(record).map(
			([k,v]) => `${k}: ${computationToString(v)}`
		)+'})')

	return S.xet( instances, newPath.join('.'), () =>
		createChildStore(
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
			newPath
		)
	)
}

function whereUnnested <T, TT extends Unnest<T>, K extends keyof TT, V extends TT[K]>(
	this: Store<T>
	, record: Partial<
		Record<K, S.Computation<V> >
	>
) : Store<Unnest<T>> {

	const anyRecord = record as Record<string, any>;
	const newPath = 
		this.path.concat('whereUnnested({'+Object.entries(record).map(
			([k,v]) => `${k}: ${computationToString(v)}`
		)+'})')

	return S.xet(instances, newPath.join('.'), () => 
		createChildStore(
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
			newPath,
		)
	)
}

function focus<T, U> (
	this: Store<T>
	, getter: (row: T) => U[] | []
	, setter: (state: T, update: ( (row:U) => U) ) => T
)  {
	const key = `focus(${getter})`
	const newPath = this.path.concat(key)
	return S.xet(
		instances,
		newPath.join('.'),
		() => createChildStore(getter, setter, this, newPath)
	)
}

export function createStore<T>(name:string, table: T[]): Store<T> {

	// we use () => as equality because the result set changes all the
	// time, its not a legitimate way to detect conflicts, you'd have
	// to do some really deep comparisons to identify duplicate writes
	// and for this system it wouldn't mean anything
	//
	// leaf conflicts should probably be captured/detected in this layer
	// not in S, but any 2 writes will be techinically deemed a conflict 
	// because the state tree is being set to two different immutable
	// objects and result sets
	const stateStream = S.data(table, () => true);
	
	const setState: Store<T>["setState"] = (f) => {
		stateStream(S.sample(stateStream).map( row => f(row) ))
	};

	const path = [name]

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
		path
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
	setter: (parent: Parent, update: (x:Child) => Child ) => Parent,
	parentStore: Store<Parent>,
	path: string[],
): Store<Child> {

	const read$ = U.dropRepeatsWith(
		U.map( (results) => {
			let out = results.flatMap( row => getter(row) )
			return out
		}, parentStore.getReadStream()),
		(tableA, tableB) => tableA.length === tableB.length	&& tableA.every( (rowA,i) => rowA === tableB[i])
	);

	const setState = (f: (row: Child) => Child) => {
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
		path
	};

	notify.set(store, (f) => {
		notify.get(parentStore)!(
			(parent) => setter(parent, f)
		)
	});

	return store;
}

export { root } from './index.js'