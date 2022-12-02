import * as S from './index.js'

import * as U from './utils.js'

type Unnest<T> = T extends Array<any> ? T[number] : never;

export type Store<T> = {
	sample(): T;
	sampleAll(): T[];
	read(): T;
	readAll(): T[];
	write(f: (row: T) => T): void;
	getReadStream: () => S.Computation<T[]>;
	focus<U>(
		get: (row: T) => U[] | [],
		set: (state: T, update: ( (row:U) => U) ) => T,
	): Store<U>;

	prop<K extends keyof T>(key: K): Store<T[K]>,
	unnest: () => Store<Unnest<T>>,
	
	filter( f: ( (row:T) => boolean) ): Store<T>

	path: string[]
};

type NotifyMap<T> = WeakMap<Store<T>, (
	(f: ((row:T) => T)) => void
)>;

const notify: NotifyMap<any> = new WeakMap();

// come back to this later: https://github.com/JAForbes/S/issues/20
// const instances: Map<string, Store<any>> = new Map()

function prop<T, K extends keyof T>(this: Store<T>, key: keyof T) : Store<T[K]> {
	const newPath = this.path.concat(String(key))

	return createChildStore(
		row => [row[key]]
		, (parent, update) => ({ ...parent, [key]: update(parent[key])})
		, this
		, newPath
	) as Store<T[K]>
	
}
function unnest<T>(this: Store<T>){
	const newPath = this.path.concat('unnest()')

	return createChildStore(
		arrayRow => (arrayRow as any[]),
		(arrayRow, update) => (arrayRow as any[]).map( unnestedRow => update(unnestedRow) ) as T,
		this,
		newPath
	)
}

function filter<T>(this: Store<T>, f: (row:T) => boolean) {
	const newPath = this.path.concat('filter('+f+')')

	return createChildStore(
		row => f(row) ? [row] : [],
		(row, update) => (f(row) ? update(row) : row ),
		this,
		newPath
	)
}

function focus<T, U> (
	this: Store<T>
	, getter: (row: T) => U[] | []
	, setter: (state: T, update: ( (row:U) => U) ) => T
)  {
	const key = `focus(${getter})`
	const newPath = this.path.concat(key)
	return createChildStore(getter, setter, this, newPath)
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
	let lastWrite = table

	let runOncePerTick = () => {
		stateStream(lastWrite)
	}

	const write: Store<T>["write"] = (f) => {
		lastWrite = lastWrite.map( row => f(row) )

		S.runOncePerTick(runOncePerTick)
	};

	const path = [name]

	let store : Store<T> = {
		sample: () => S.sample(stateStream)[0],
		sampleAll: () => S.sample(stateStream),
		write,
		read: () => stateStream()[0],
		readAll: () => stateStream(),
		getReadStream: () => stateStream,
		focus,
		prop,
		unnest,
		filter,
		path
	};

	notify.set(store, (f) => {
		
		lastWrite = lastWrite.map( 
			row => f(row)
		)
		
		S.runOncePerTick(runOncePerTick)
	});

	return store;
}

const compareResultSetReferences = <T>(a:T[],b:T[]) => {
	for( let i = 0; i < Math.max(a.length, b.length); i++ ) {
		if ( a[i] !== b[i] ) {
			return false
		}
	}
	return true
}

function createChildStore<Parent, Child>(
	getter: (parent: Parent) => Child[],
	setter: (parent: Parent, update: (x:Child) => Child ) => Parent,
	parentStore: Store<Parent>,
	path: string[],
): Store<Child> {

	const read$ =
	 U.dropRepeatsWith(
		U.map( (results) => {
			let out = results.flatMap( row => getter(row) )
			return out
		}, parentStore.getReadStream()),
		compareResultSetReferences
	);

	const write = (f: (row: Child) => Child) => {
		notify.get(parentStore)!(
			(parent: Parent) => setter(parent, f)
		);
	};
	
	let store: Store<Child> = {
		sample: () => S.sample(read$)[0],
		sampleAll: () => S.sample(read$),
		read: () => read$()[0],
		readAll: () => read$(),
		write,
		getReadStream: () => read$,
		focus,
		prop,
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