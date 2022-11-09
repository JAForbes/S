type Root =
    { type: 'Root'
    , tag: 'Root'
    }

type SyncComputationInternal<T> =
    { type: 'Stream'
    , tag: 'SyncComputation'
    , value?: T
    , next?: T
    , compute: () => void;
    }

type GeneratorComputationInternal<T> =
    { type: 'Stream'
    , tag: 'GeneratorComputation'
    , value?: T
    , next?: T
    , compute: () => void;
    }

type ComputationInternal<T> =
    | SyncComputationInternal<T>
    | GeneratorComputationInternal<T>

type DataInternal<T> =
    { type: 'Stream'
    , tag: 'Data'
    , value?: T
    , next?: T
    }

type StreamInternal<T> =
    | DataInternal<T>
    | ComputationInternal<T>

type State = 'frozen' | 'propagating' | 'idle'

let state : State = 'idle';

let activeRoot : Root | null = null;

const rootChildren = new WeakMap<Root, Set<ComputationInternal<unknown>>>();
const rootOfStream = new WeakMap<ComputationInternal<unknown>, Root>();

/**
 * The computations that will need to rerun next tick
 */
let toRun = new Set<ComputationInternal<unknown>>();

/**
 * The direct dependencies of a stream, used in computeDependents
 * to compute all descendant dependencies at tick time
 */
let dependents = new WeakMap<StreamInternal<unknown>, Set<ComputationInternal<unknown>>>();

/**
 * A computation can have n cleanups, we store them in a set for each stream
 * and clear the list every tick
 */
let cleanups = new Map<ComputationInternal<unknown>, Set<VoidFunction>>;

/**
 * Track the computation call stack so we know which computations
 * depend on other streams when read in their context.
 *
 * Also used to store the computations parents at definition time.
 */
let active : ComputationInternal<unknown>[] = []

/**
 * When a stream updates, we do not immediately update the
 * value, instead we set stream.next.  We then queue up
 * the stream value to update at the end of the tick
 * by putting those streams in a queue.
 */
let streamsToResolve = new Set<StreamInternal<unknown>>;

/**
 * If a write happens when a propagation is already running
 * we store the set invocation in a list so we can trigger
 * the tick once the current tick completes.
 */
let nextTicks : Array<() => any> = [];

/**
 * The parents of a computation, used to prevent children
 * computation streams being recomputed if the outer
 * computation will already be running it for free.
 *
 * Without this your inner most computations will
 * update ^n number of nested computations, not fun!
 */
let parents = new WeakMap<ComputationInternal<unknown>, Set<ComputationInternal<unknown>>>();
let children = new WeakMap<ComputationInternal<unknown>, Set<ComputationInternal<unknown>>>();

let computingOnComputation : boolean = false;

export class StreamError extends Error {}
export class CleanupWithoutComputationContext extends StreamError {}
export class Conflict extends StreamError {}
export class ComputationWithoutRoot extends StreamError {}
export class RunawayTicks extends StreamError {}

export const MAX_TICKS = 100_000
export let runawayTicks = 0

/**
 * For tests and debugging.
 */
export const stats = {
    ticks: 0,
    computations: {
        evaluated: 0
    }
}

/**
 * What the outside world sees/uses
 */
export interface Signal<T, U=T> {
    (): U;
    (x:T) : U;
    ( fn: (( x: U ) => U ) ) : U;
}

export type AnyMap<K extends object,V> = WeakMap<K, V> | Map<K, V>;

// Typed version of https://www.npmjs.com/package/xet
// by @barneycarroll
export function xet<K extends object, V>(
    map: AnyMap<K,V>,
    key: K,
    fn: (key: K, map: AnyMap<K,V>) => V
) : V {
    if(map.has(key)) {
        return map.get(key) as V
    }

    const value = fn(key, map)

    map.set(key, value)

	return value
}

/**
 * When some data changes, direct dependencies need to
 * be updated.  But if those dependencies update, the
 * dependendies of those dependenies need to update.
 *
 * When we know we're about to tick, we compute
 * that recursive structure into a flat list before
 * the tick starts.
 *
 * I prefer it this way, but it also works well with
 * S' atomic state update model.  Only the dependencies
 * at the time the tick started matter.  If by the time
 * the tick is half way complete some new dependency
 * arises, that is a job for another tick.
 *
 * @param stream
 */
function computeDependents(stream: StreamInternal<unknown>){
    let stack : ComputationInternal<unknown> [] = []

    stack.push(...xet(dependents, stream, () => new Set()))

    dependents.get(stream)?.clear()

    while (stack.length) {
        let x = stack.shift() as ComputationInternal<unknown>;

        
        if (x.tag !== 'GeneratorComputation') {
            stack.push(...xet(dependents, x, () => new Set()))

            // already disposed, cheaper to do it here
            if ( parents.get(x) == null ) {
                // as it doesn't run, it won't
                // be added as a child ever again
                continue;
            }

            toRun.add(x)
            
        }

        toRun.add(x)
    }
}

export function on<T,U>( 
    signal : Signal<any> | Signal<any>[],
    fn: (p:T) => U,
    seed: T,
    onchanges?: boolean
) : Computation<U>

export function on<T,U>( 
    signal : Signal<unknown> | Signal<unknown>[],
    fn: (p:T | undefined) => U,
    seed?: T,
    onchanges?: boolean
) : Computation<U> {
    
    const signals = [].concat(signal as any) as Signal<unknown>[];

    const stream : SyncComputationInternal<T> = {
        type: "Stream",
        tag: 'SyncComputation',
        value: seed,
        next: seed,
        compute(){

            let oldActive = active
            active = []
            computingOnComputation = true
            stream.next = fn(stream.value) as unknown as T;
            computingOnComputation = false
            active = oldActive
            if ( state === 'idle' ) {
                stream.value = stream.next
            } else {
                streamsToResolve.add(stream)
            }
        }
    }

    // whatever active was when this was defined
    // is our parents
    parents.set(stream, new Set(active))
    for( let x of active ) {  
        xet(children, x, () => new Set()).add( stream )
    }

    if (activeRoot === null) {
        throw new ComputationWithoutRoot()
    }

    // so we can dispose this when the root is
    // disposed
    xet(rootChildren, activeRoot, () => new Set())
        .add(stream)
    rootOfStream.set(stream, activeRoot)

    active.unshift(stream)
    for( let signal of signals ) {
        signal()
    }
    active.shift()

    if (!onchanges){
        stream.compute()
    }

    return () => {

        if ( active[0] ) {
            xet(dependents, stream, () => new Set())
                .add(active[0])

            return stream.next as U;
        } else if ( computingOnComputation ) {
            return stream.next as U
        } else {
            return stream.value as U
        }
    }
}


// these overloads are here to ensure streams with an initial value
// are not "possibly undefined"
export function value<T>(value: T, predicate:(a:T,b:T) => boolean =((a,b) => a === b) ){

    const stream : DataInternal<T> = {
        type: 'Stream',
        tag: 'Data',
        next: value,
        value
    }

    let accessor = (...args: T[] | [(( x?: T ) => T )] ) => {

        if ( args.length ) {

            if ( state === 'propagating' ) {
                nextTicks.push(() => (accessor as any)(...args))
                return stream.value
            }
            let nextVal: T;
            if ( typeof args[0] === 'function' ) {
                nextVal = (args[0] as any)(stream.value)
            } else {
                nextVal = args[0]
            }

            if ( streamsToResolve.has(stream) && nextVal != stream.next ) {
                throw new Conflict()
            } else if (predicate(nextVal,stream.value!)) {
                return stream.value
            } else  {
                stream.next = nextVal
                streamsToResolve.add(stream)
            }

            computeDependents(stream)

            if ( state === 'idle' ) {
                tick()
            }

        } else if ( active[0] ) {
            xet(dependents, stream, () => new Set())
                .add(active[0])

            return stream.next
        } else if ( computingOnComputation ) {
            return stream.next
        } else {
            return stream.value
        }
    }

    return accessor
}

// these overloads are here to ensure streams with an initial value
// are not "possibly undefined"
export function data<T>(value: T) : Signal<T>;
export function data<T>(value?: T) : Signal<T | undefined>
export function data<T>(value?: T){

    const stream : DataInternal<T> = {
        type: 'Stream',
        tag: 'Data',
        next: value,
        value
    }

    let accessor = (...args: T[] | [(( x?: T ) => T )] ) => {

        if ( args.length ) {

            if ( state === 'propagating' ) {
                nextTicks.push(() => (accessor as any)(...args))
                return stream.value
            }
            let nextVal: T;
            if ( typeof args[0] === 'function' ) {
                nextVal = (args[0] as any)(stream.value)
            } else {
                nextVal = args[0]
            }

            if ( streamsToResolve.has(stream) && nextVal != stream.next ) {
                throw new Conflict()
            } else {
                stream.next = nextVal
                streamsToResolve.add(stream)
            }

            computeDependents(stream)

            if ( state === 'idle' ) {
                tick()
            }

        } else if ( active[0] ) {
            xet(dependents, stream, () => new Set())
                .add(active[0])

            return stream.next
        } else if ( computingOnComputation ) {
            return stream.next
        } else {
            return stream.value
        }
    }

    return accessor
}

type SyncComputationVisitor<T> =
    | (() => undefined)
    | (() => T)
    | ((previous: T) => T)
    ;

export type Computation<T> = () => T;

export function computation<T>( fn: SyncComputationVisitor<T>, seed: T ) : Computation<T>
export function computation<T>( fn: SyncComputationVisitor<T>, seed?: T) : Computation<T | undefined> 
export function computation<T>( fn: SyncComputationVisitor<T>, seed: T ) : Computation<T> {
    const stream : SyncComputationInternal<T> = {
        type: "Stream",
        tag: 'SyncComputation',
        value: seed,
        compute(){

            active.unshift(stream)
            stream.next = fn(stream.value!);
            active.shift()

            if ( state === 'idle' ) {
                stream.value = stream.next
            } else {
                streamsToResolve.add(stream)
            }
        }
    }

    // whatever active was when this was defined
    // is our parents
    parents.set(stream, new Set(active))
    for( let x of active ) {  
        xet(children, x, () => new Set()).add( stream )
    }

    
    if (activeRoot === null) {
        throw new ComputationWithoutRoot()
    }

    // so we can dispose this when the root is
    // disposed
    xet(rootChildren, activeRoot, () => new Set())
        .add(stream)
    rootOfStream.set(stream, activeRoot)

    stream.compute()

    return () => {

        if ( active[0] ) {
            xet(dependents, stream, () => new Set())
                .add(active[0])

            return stream.next!;
        } else if ( computingOnComputation ) {
            return stream.next!
        } else {
            return stream.value!
        }

    }
}

// only defining these types as I couldn't
// figure out typescripts Generator typings
// because I yield a promise it assumes
// the generator's final value is a promise
interface StreamGeneratorVisitor<T> {
    (previous:T) : any
}

interface StreamGeneratorVisitorInternal<T> {
    (previous:T) : StreamIterator<T>
}

interface StreamIterator<T> {
    // we don't care what you yield
    next(x: any) : { done: boolean, value: any }

    // only what you return
    return(x: T) : T

    throw(err: Error): void;
}

export function generator<T>( fn: StreamGeneratorVisitor<T> )  : Computation<T | undefined> 
export function generator<T>( fn: StreamGeneratorVisitor<T>, seed: T)  : Computation<T> 
export function generator<T>( _fn: StreamGeneratorVisitor<T>, seed?: T ) : Computation<T | undefined> {

    let iteration: Promise<T | undefined> | null;


    let it :  StreamIterator<T> | null;

    let fn = _fn as StreamGeneratorVisitorInternal<T>

    let sentinel = {};

    const stream : GeneratorComputationInternal<T> = {
        type: "Stream",
        tag: "GeneratorComputation",
        value: seed,
        compute(){

            if (iteration) {
                it!.return(sentinel as T);
            }

            it = fn(stream.value!)
            iteration = iterate(it)

            iteration.catch( err => {
                it?.throw(err)
            })

            iteration.then((maybeSentinel) => {
                iteration = null
                it = null
                if(maybeSentinel === sentinel) {
                    return;
                }

                computeDependents(stream)

                if ( state == 'idle' ) {
                    streamsToResolve.add(stream)
                    tick()
                }
            })
        }
    }

    async function iterate<T>(it: StreamIterator<T>){
        let value, done, next;
        do {
            active.unshift(stream)
            void ({ done, value } = it.next(next))
            active.shift()

            if ( value && 'then' in Object(value) ) {
                value = await value

            }

            next = value
        } while (!done)
        stream.next = value
        streamsToResolve.add(stream)
        return value
    }

    // whatever active was when this was defined
    // is our parents
    parents.set(stream, new Set(active))
    for( let x of active ) {  
        xet(children, x, () => new Set()).add( stream )
    }

    if (activeRoot === null) {
        throw new ComputationWithoutRoot()
    }

    // so we can dispose this when the root is
    // disposed
    xet(rootChildren, activeRoot, () => new Set())
        .add(stream)
    rootOfStream.set(stream, activeRoot)

    stream.compute()

    return () => {
        if (active[0]) {
            xet(dependents, stream, () => new Set())
                .add(active[0])

            return stream.next
        } else if ( computingOnComputation ) {
            return stream.next
        }
        return stream.value
    }
}

export function freeze(f: VoidFunction) : void {
    if (state == 'frozen') {
        f()
        return;
    }


    
    // If called within a computation, the system is already frozen, so freeze is inert.
    if (state == 'propagating') {
        f()
        return;
    }
    
    let oldState = state
    state = 'frozen'
    f()


    state = oldState


    tick()
}


export function cleanup(f: VoidFunction) : void {
    if ( active[0] ) {
        xet(cleanups, active[0], () => new Set())
            .add(f)
    } else {
        throw new CleanupWithoutComputationContext()
    }
}

export function root<T>(f: ( dispose: VoidFunction ) => T ){
    let root : Root = {
        type: 'Root',
        tag: 'Root'
    }

    let oldActiveRoot = activeRoot;
    activeRoot = root;

    let oldActive = active
    active = []
    let out = f(() => {
        for ( let x of rootChildren.get(root) ?? []){
            for ( let cleanup of cleanups.get(x) ?? [] ) {
                cleanup()
            }
            dependents.delete(x)
            toRun.delete(x)
            cleanups.delete(x)
            parents.delete(x)
        }
    })
    activeRoot = oldActiveRoot;
    active = oldActive

    return out
}

export function parentScheduled(
    computation: ComputationInternal<unknown>
    , scheduledToRun: Set<ComputationInternal<unknown>>
) {
    for( let parent of parents.get(computation)! ) {
        if ( scheduledToRun.has(parent) ) {
            return true;
        }
    }
    return false;
}

export function tick(){
    if (state === 'propagating' || state === 'frozen' ) return;

    stats.ticks++

    state = 'propagating'

    let oldToRun = new Set(toRun)

    toRun.clear()

    let allChildren = new Set<ComputationInternal<unknown>>();
    for( let x of oldToRun ) {
        for( let child of children.get(x) ?? [] ) {
            // record the child exists
            allChildren.add(child)
            // add to the tick so we can run
            // the clean up fns (at most once)
            oldToRun.add(child)
            parents.delete(child)
            streamsToResolve.delete(child)
            // should we delete the dependents too?
            dependents.delete(x)
        }

        // start again
        children.delete(x)
    }
    

    for( let f of oldToRun ) {
        for( let cleanupFn of xet(cleanups, f, () => new Set()) ) {
            cleanupFn()
            cleanups.get(f)!.delete(cleanupFn)
        }

        // if is a child, we only need to clean up
        if ( allChildren.has(f) ) {
            continue;
        } else {
            let oldActive = active
            active = [...parents.get(f) ?? []]
            
            let oldActiveRoot = activeRoot
            activeRoot = rootOfStream.get(f) ?? null;

            f.compute()

            active = oldActive
            activeRoot = oldActiveRoot;
            stats.computations.evaluated++
        }

    }


    for ( let s of streamsToResolve ) {
        s.value = s.next
    }
    streamsToResolve.clear()

    state = 'idle'

    if (runawayTicks > 0) return;
    while ( nextTicks.length ) {
        let next = nextTicks.shift()

        runawayTicks++

        if (runawayTicks > MAX_TICKS ) {
            throw new RunawayTicks()
        }
        next!()
    }
    runawayTicks = 0;
}


export function sample<T>(signal: Signal<T>){
    let oldActive = active
    active = [];
    let value = signal()
    active = oldActive
    return value;
}