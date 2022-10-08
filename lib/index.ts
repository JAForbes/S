export type SyncComputation<T> = 
    { type: 'Stream'
    , tag: 'SyncComputation'
    , value?: T
    , next?: T
    , compute: () => void;
    }

export type GeneratorComputation<T> = 
    { type: 'Stream'
    , tag: 'GeneratorComputation'
    , value?: T
    , next?: T 
    , compute: () => void;
    }

export type Computation<T> = 
    | SyncComputation<T> 
    | GeneratorComputation<T>

export type Data<T> = 
    { type: 'Stream'
    , tag: 'Data'
    , value?: T
    , next?: T 
    }

export type Stream<T> = 
    | Data<T> 
    | Computation<T>

export type Initiator = 
    { type: 'Initiator'
    , tag: 'GeneratorComputation' 
    , value: GeneratorComputation<unknown>
    }
    | 
    { type: 'Initiator'
    , tag: 'Data[]'
    , value: Data<unknown>[]
    }

export type State = 'frozen' | 'propagating' | 'idle'

export let state : State = 'idle';
// export let initiator : Initiator | null = null;
export let toRun = new Set<Computation<unknown>>();
export let dependents = new WeakMap<Stream<unknown>, Set<Computation<unknown>>>();
export let cleanups = new Map<Computation<unknown>, Set<VoidFunction>>;
export let active : Computation<unknown>[] = []
export let streamsToResolve = new Set<Stream<unknown>>;
export let nextTicks : Array<() => any> = [];
export let doNotReCompute = new Set<Computation<unknown>>();
export let children = new WeakMap<Computation<unknown>, Set<Computation<unknown>>>();

export class SError extends Error {}
export class CleanupWithoutComputationContext extends SError {}
export class DuplicateGeneratorInitiatior extends SError {}
export class MixedInitiatorType extends SError {}
export class UnexpectedInitiatorClause extends SError {}
export class Conflict extends SError {}
export class FreezingWhilePropagating extends SError {}

export const stats = {
    ticks: 0,
    computations: {
        evaluated: 0
    }
}

export interface StreamAccessor<T> {
    (): T | undefined;
    (x:T) : T | undefined;
    ( fn: (( x?: T ) => T ) ) : T | undefined;
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

// function addInitiator(stream: Data<unknown> | GeneratorComputation<unknown> ){
//     if ( initiator != null && stream.tag == 'GeneratorComputation' ) {
//         throw new DuplicateGeneratorInitiatior()
//     } else if ( initiator != null && stream.tag === 'GeneratorComputation' ) {
//         initiator = {
//             type: 'Initiator',
//             tag: 'GeneratorComputation',
//             value: stream
//         }
//     } else if ( stream.tag === 'Data' && initiator?.tag === 'GeneratorComputation' ) {
//         throw new MixedInitiatorType()
//     } else if ( initiator != null && stream.tag === 'Data' && initiator.tag === 'Data[]' ) {
//         initiator.value.push(stream)
//     } else if ( initiator == null && stream.tag === 'Data' ) {
//         initiator = {
//             type: 'Initiator',
//             tag: 'Data[]',
//             value: [stream]
//         }
//     } else {
//         throw new UnexpectedInitiatorClause()
//     }
// }

function computeDependents(stream: Stream<unknown>){
    let stack : Computation<unknown> [] = []

    stack.push(...xet(dependents, stream, () => new Set()))

    while (stack.length) {
        let x = stack.shift() as Computation<unknown>;

        if (x.tag !== 'GeneratorComputation') {
            stack.push(...xet(dependents, x, () => new Set()))
            
            toRun.add(x)

            dependents.get(stream)!.delete(x)
        }

        toRun.add(x)
    }
}

function cleanupChildren(stream: Computation<unknown>){
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

    let xs = [...xet(children, stream, () => new Set<Computation<unknown>>() )]
    for( let x of xs ) {
        doNotReCompute.add(x)
    }
}

export function data<T>(value?: T) : StreamAccessor<T> {
    
    const stream : Data<T> = {
        type: 'Stream',
        tag: 'Data',
        next: value,
        value
    }

    let accessor : StreamAccessor<T> = (...args: T[] | [(( x?: T ) => T )] ) => {

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
                // addInitiator(stream)
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
    const stream : SyncComputation<T> = {
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

type GeneratorComputationVisitor<T> = () => Generator<T, T, any>

export function generator<T>( fn: any ) : ComputationAccessor<T> {

    let iteration: Promise<T | undefined> | null;
    let it :  ReturnType<typeof fn> | null;
    let sentinel = {};
    const stream : GeneratorComputation<T> = {
        type: "Stream",
        tag: "GeneratorComputation",
        compute(){
            if (iteration) {
                it!.return(sentinel);
            }

            it = fn()
            iteration = iterate(it)

            iteration.then((maybeSentinel) => {
                if(maybeSentinel === sentinel) {
                    return;
                }

                computeDependents(stream)
                
                if ( state == 'idle' ) {
                    // addInitiator(stream)
                    streamsToResolve.add(stream)
                    tick()
                } 
            })
            iteration = null
            it = null
        }
    }

    async function iterate(it: Generator<T>){
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

    // initiator = null
    
    
    if ( next ) {
        next()
    }
}


export function sample<T>(signal: StreamAccessor<T>){
    let oldActive = active
    active = [];
    let value = signal()
    active = oldActive
    return value;
}