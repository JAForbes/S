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


export class StreamError extends Error {}
export class CleanupWithoutComputationContext extends StreamError {}
export class Conflict extends StreamError {}
export class FreezingWhilePropagating extends StreamError {}

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

    while (stack.length) {
        let x = stack.shift() as ComputationInternal<unknown>;

        if (x.tag !== 'GeneratorComputation') {
            stack.push(...xet(dependents, x, () => new Set()))
            
            toRun.add(x)

            dependents.get(stream)!.delete(x)
        }

        toRun.add(x)
    }
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

        if ( args.length ) {                                                            // set

            if ( state === 'propagating' ) {                                            // if already propagating
                nextTicks.push(() => (accessor as any)(...args))                        // remember this write for later
                return stream.value                                                     // return the current resolved value
            }
            let nextVal: T;                                                             // set by value or visitor function
            if ( typeof args[0] === 'function' ) {
                nextVal = (args[0] as any)(stream.value)
            } else {
                nextVal = args[0]
            }
            
            if ( streamsToResolve.has(stream) && nextVal != stream.next ) {             // if this stream has already been set this tick
                throw new Conflict()                                                    // and the value is different, throw a conflict
            } else {
                stream.next = nextVal                                                   // otherwise store this next value and queue 
                streamsToResolve.add(stream)                                            // stream.value = stream.next for the end of
            }                                                                           // the tick


            computeDependents(stream)                                                   // if we're not already propagating (we're not)
                                                                                        // compute the full dependency tree

            if ( state === 'idle' ) {                                                   // tick if we're not frozen
                tick()
            }

        } else if ( active[0] ) {                                                       // if the data is being read inside a computation
            xet(dependents, stream, () => new Set())                                    // remember that that computation depends on this
                .add(active[0])                                                         // data

            return stream.next                                                          // inside a computation we allow you to see the 
                                                                                        // next value
        } else {
            return stream.value                                                         // otherwise we show you the current resolved value
        }
    }

    return accessor
}

type SyncComputationVisitor<T> = 
    | (() => undefined) 
    | (() => T | undefined)
    | ((previous?: T) => T | undefined)
    ;

export type Computation<T> = () => T | undefined;

export function computation<T>( fn: SyncComputationVisitor<T> ) : Computation<T> {
    const stream : SyncComputationInternal<T> = {
        type: "Stream",
        tag: 'SyncComputation',
        compute(){

            active.unshift(stream)                                                      // add ourselves to the active stack
            stream.next = fn(stream.value);                                             // for the benefit of child computations
            active.shift()

            if ( state === 'idle' ) {                                                   // if we're not in a tick
                stream.value = stream.next                                              // just update the value straight away
            } else {
                streamsToResolve.add(stream)                                            // otherwise, update it at the end of the tick
            }
        }
    }

    stream.compute()                                                                    // initialize it
    
    // whatever active was when this was defined
    // is our parents
    parents.set(stream, new Set(active))

    return () => {
        
        if ( active[0] ) {                                                              // if we're inside a computation
            xet(dependents, stream, () => new Set())                                    // record it depends on us
                .add(active[0])

            return stream.next;                                                         // allow the computation to see
                                                                                        // the new value immediately
        }
        return stream.value                                                             // outside of computations we only
                                                                                        // share the resolved value
    }
}

// only defining these types as I couldn't
// figure out typescripts Generator typings
// because I yield a promise it assumes
// the generator's final value is a promise
interface StreamGeneratorVisitor<T> {
    () : StreamIterator<T>
}

interface StreamIterator<T> {
    // we don't care what you yield
    next(x: any) : { done: boolean, value: any }

    // only what you return
    return(x: T) : T

    throw(err: Error): void;
}

export function generator<T>( _fn: any ) : Computation<T> {

    let iteration: Promise<T | undefined> | null;                                       // the return value of iterate
                                                                                        // resolved when the generator is complete

    let it :  StreamIterator<T> | null;                                                 // the generator's iterator

    let fn = _fn as StreamGeneratorVisitor<T>                                           // the generator function itself
    
    let sentinel = {};                                                                  // how we (currently) track that it.return()
                                                                                        // was called, which is what happens
                                                                                        // when we cancel an old computation mid flight


    const stream : GeneratorComputationInternal<T> = {                                  // like a sync computation, but if the computation 
        type: "Stream",                                                                 // is suspended when a dependency triggers, we cancel
        tag: "GeneratorComputation",                                                    // the old computation and start a new one
        compute(){                                                                      // so there is never 2 instances of the same
                                                                                        // async computation running at any given time

            if (iteration) {                                                            // if a computation is running:
                it!.return(sentinel as T);                                              // cancel it
            }

            it = fn()                                                                   // start a new one
            iteration = iterate(it)                                                     // handle promises etc

            iteration.catch( err => {                                                   // if an error occurs inside iterate
                it?.throw(err)                                                          // pass it to the try catch inside
            })                                                                          // generator fn

            iteration.then((maybeSentinel) => {         
                iteration = null
                it = null                                                               // when the computation finishes
                if(maybeSentinel === sentinel) {                                        // and if we didn't cancel it
                    return;
                }

                computeDependents(stream)                                               // kick off a new tick
                
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
            active.unshift(stream)                                                      // when the computation runs
            void ({ done, value } = it.next(next))                                      // we add ourselves to the stack
            active.shift()                                                              // for the benefit of child computations

            if ( value && 'then' in Object(value) ) {                                   // if a promise is returned
                value = await value                                                     // resolve it, 
                                                                                        // (rejections are handled in compute)
            }

            next = value                                                                // whatever was resolved, echo it back
        } while (!done)
        stream.next = value                                                             // when the generator ends, stash the value
        streamsToResolve.add(stream)                                                    // on next, and queue up the resolution
        return value
    }

    stream.compute()                                                                    // initialize the stream
    
    // whatever active was when this was defined
    // is our parents
    parents.set(stream, new Set(active))

    return () => {                                                                      // same behaviour as a sync computation
        if (active[0]) {
            xet(dependents, stream, () => new Set())
                .add(active[0])

            return stream.next
        }
        return stream.value
    }
}

export function freeze(f: VoidFunction) : void {
    if (state == 'frozen') {                                                            // already frozen, so just run f()
        f()
        return;
    }
    if ( state == 'propagating' ) {                                                     // maybe this is fine? my thinking is
        // this might be fine, not sure yet                                             // the intention of a freeze is to
        throw new FreezingWhilePropagating()                                            // prevent a tick, so if a tick has
    }                                                                                   // already started, maybe expectations are subverted

    let oldState = state                                                                // maybe state should be a stack?
    state = 'frozen'
    f()                                                                                 // run the freeze fn, all child computations etc
                                                                                        // will now not start a tick, instead just queuing up
                                                                                        // the change
    state = oldState
    
    
    tick()                                                                              // now we can tick
}


export function cleanup(f: VoidFunction) : void {                                       // record a cleanup to run next tick
    if ( active[0] ) {
        xet(cleanups, active[0], () => new Set())
            .add(f)
    } else {
        throw new CleanupWithoutComputationContext()
    }
}

export function root(f: ( dispose: VoidFunction ) => void ){                            // nothing fancy except a place to run all cleanup fns
    f(() => {                                                                           // should only run cleanups for computations belonging 
        for( let xs of cleanups.values() ){                                             // to this root, but for now just cleans up everything
            for( let cleanupFn of xs ) {
                cleanupFn()
            }
        }
        cleanups.clear()
    })
}

export function parentScheduled(                                                        // if a parent computation is going to run
    computation: ComputationInternal<unknown>                                           // there is no point also scheduling the child to run
    , scheduledToRun: Set<ComputationInternal<unknown>>                                 // because the child will run for free
) {
    for( let parent of parents.get(computation)! ) {
        if ( scheduledToRun.has(parent) ) {
            return true;
        }
    }
    return false;
}

export function tick(){
    if (state === 'propagating' || state === 'frozen' ) return;                         // should never happen, maybe throw?

    stats.ticks++

    state = 'propagating'

    let oldToRun = new Set(toRun)                                                       // for checking parentScheduled

    toRun.clear()                                                                       // brand new day

    for( let f of oldToRun ) {
        for( let cleanupFn of xet(cleanups, f, () => new Set()) ) {                     // run the clean up
            cleanupFn()
            cleanups.get(f)!.delete(cleanupFn)                                          // then clean up the clean up...
        }

        if ( !parentScheduled(f, oldToRun) ) {                                          // if safe to run, run it
            let oldActive = active
            active = [...parents.get(f) ?? []]                                          // restore the active at definition time
            f.compute()
            active = oldActive
            stats.computations.evaluated++
        } 

    }
    

    for ( let s of streamsToResolve ) {                                                 // resolve state changes
        s.value = s.next                                                                // an extra loop so the transaction is complete
    }                                                                                   // before the state changes
    streamsToResolve.clear()

    state = 'idle'

    let next = nextTicks.shift()                                                        // if there was a tick created mid-tick, kick it off
    
    
    if ( next ) {
        next()
    }
}


export function sample<T>(signal: Signal<T>){                                           // pretend active is empty to prevent tick triggering
    let oldActive = active
    active = [];
    let value = signal()
    active = oldActive
    return value;
}