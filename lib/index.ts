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
let toRun = new Set<ComputationInternal<unknown>>();
let dependents = new WeakMap<StreamInternal<unknown>, Set<ComputationInternal<unknown>>>();
let cleanups = new Map<ComputationInternal<unknown>, Set<VoidFunction>>;
let active : ComputationInternal<unknown>[] = []
let streamsToResolve = new Set<StreamInternal<unknown>>;
let nextTicks : Array<() => any> = [];
let doNotReCompute = new Set<ComputationInternal<unknown>>();
let children = new WeakMap<ComputationInternal<unknown>, Set<ComputationInternal<unknown>>>();

export class SError extends Error {}
export class CleanupWithoutComputationContext extends SError {}
export class Conflict extends SError {}
export class FreezingWhilePropagating extends SError {}

export const stats = {
    ticks: 0,
    computations: {
        evaluated: 0
    }
}

export interface Signal<T, U=T> {
    (): U;
    (x:T) : U;
    ( fn: (( x: U ) => U ) ) : U;
}

export type AnyMap<K extends object,V> = WeakMap<K, V> | Map<K, V>;

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

function cleanupChildren(stream: ComputationInternal<unknown>){
    // the active list captures all the parent scopes
    // of a computation
    // if each computation simply recorded it we could
    // scan it for our own stream and then that's
    // a child to be cleaned up
    // we can do this work upfront
    // adding ourselves to each parent computations
    // children set
    // then when a parent runs, we just access the children
    // and run the clean ups, and ban them from
    // the next tick

    let xs = [...xet(children, stream, () => new Set<ComputationInternal<unknown>>() )]
    for( let x of xs ) {
        doNotReCompute.add(x)
    }
}


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

            if ( state === 'frozen' || state === 'idle' ) {
                computeDependents(stream)
            }

            if ( state === 'idle' ) {
                tick()
            }

        } else if ( active[0] ) {
            xet(dependents, stream, () => new Set())
                .add(active[0])

            return stream.next
        } else {
            return stream.value
        }
    }

    return accessor
}

type SyncComputationVisitor<T> = 
    | (() => undefined) 
    | (() => T | undefined)
    | ((previous?: T) => T | undefined)
    ;

type ComputationAccessor<T> = () => T | undefined;

export function computation<T>( fn: SyncComputationVisitor<T> ) : ComputationAccessor<T> {
    const stream : SyncComputationInternal<T> = {
        type: "Stream",
        tag: 'SyncComputation',
        compute(){

            
            cleanupChildren(stream)

            active.unshift(stream)
            stream.next = fn(stream.value);
            active.shift()

            if ( state === 'idle' ) {
                stream.value = stream.next
            } else if ( state === 'frozen' || state == 'propagating' ) {
                streamsToResolve.add(stream)
            }
        }
    }

    stream.compute()

    return () => {
        
        if ( active[0] ) {
            xet(dependents, stream, () => new Set())
                .add(active[0])

            return stream.next;
        }
        return stream.value
    }
}

// type GeneratorComputationVisitor<T> = () => Generator<T, T, any>

interface SGeneratorVisitor<T> {
    () : SIterator<T>
}

interface SIterator<T> {
    next(x: any) : { done: boolean, value: any }
    return(x: T) : T
}

export function generator<T>( _fn: any ) : ComputationAccessor<T> {

    let iteration: Promise<T | undefined> | null;
    let it :  SIterator<T> | null;
    let fn = _fn as SGeneratorVisitor<T>
    let sentinel = {};
    const stream : GeneratorComputationInternal<T> = {
        type: "Stream",
        tag: "GeneratorComputation",
        compute(){
            if (iteration) {
                it!.return(sentinel as T);
            }

            it = fn()
            iteration = iterate(it)

            iteration.then((maybeSentinel) => {
                if(maybeSentinel === sentinel) {
                    return;
                }

                computeDependents(stream)
                
                if ( state == 'idle' ) {
                    streamsToResolve.add(stream)
                    tick()
                } 
            })
            iteration = null
            it = null
        }
    }

    async function iterate<T>(it: SIterator<T>){
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

    stream.compute()

    return () => {
        if (active[0]) {
            xet(dependents, stream, () => new Set())
                .add(active[0])

            return stream.next
        }
        return stream.value
    }
}

export function freeze(f: VoidFunction) : void {
    if ( state == 'propagating' ) {
        // this might be fine, not sure yet
        throw new FreezingWhilePropagating()
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

export function root(f: ( dispose: VoidFunction ) => void ){
    f(() => {
        for( let xs of cleanups.values() ){
            for( let cleanupFn of xs ) {
                cleanupFn()
            }
        }
        cleanups.clear()
    })
}

export function tick(){
    if (state === 'propagating' || state === 'frozen' ) return;

    stats.ticks++

    state = 'propagating'

    let items = [...toRun]
    toRun.clear()

    for( let f of items ) {
        for( let cleanupFn of xet(cleanups, f, () => new Set()) ) {
            cleanupFn()
            cleanups.get(f)!.delete(cleanupFn)
        }

        if (! doNotReCompute.has(f) ) {
            f.compute()
            stats.computations.evaluated++
        } else {
            doNotReCompute.delete(f)
        }

    }
    

    for ( let s of streamsToResolve ) {
        s.value = s.next
    }
    streamsToResolve.clear()

    state = 'idle'

    let next = nextTicks.shift()
    
    
    if ( next ) {
        next()
    }
}


export function sample<T>(signal: Signal<T>){
    let oldActive = active
    active = [];
    let value = signal()
    active = oldActive
    return value;
}