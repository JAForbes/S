import * as S from './index.js'

interface UsedState<Desired, Initial=Desired> {
    use: <W>( fn: ((x: Desired) => W) ) => UsedState<W>;

    // getter
    () : Initial

    all: () => Initial[]

    // setters
    (x: Desired ) : Desired
    (fn: ( (x: Initial) => Desired ) ) : Desired
}

type PathItemGet = { type: 'PathItem', tag: 'get', value: string | number }
type PathItem = 
    | PathItemGet
    | { type: 'PathItem', tag: 'find', value: (x: any) => boolean }
    | { type: 'PathItem', tag: 'filter', value: (x: any) => boolean }
    | { type: 'PathItem', tag: 'map', value: (x: any) => any }
    | { type: 'PathItem', tag: 'flatMap', value: (x: any) => any }

type Path = PathItem[]
type StaticPath = PathItemGet[]

let recorderMethods = new Set(['find', 'filter', 'map', 'flatMap'])
// returns a proxy that records what was accessed
// and returns an abstract representation that can be interpreted
function Recorder(){

    const path : Path = []
    const staticPath: StaticPath = []
    let target = (() => {}) as object

    const proxy : ProxyHandler<any> = new Proxy(target, {
        get(_, key, __){
            if ( typeof key !== 'string' ) {
                return null
            }

            if ( recorderMethods.has(key) ) {
                return (fn: (x:any) => boolean ) => {
                    path.push({ type: 'PathItem', tag: key, value: fn } as PathItem)
                    return proxy
                }
            }

            path.push({ type: 'PathItem', tag: 'get', value: key })
            return proxy
        },
        apply(){
            throw new Error('Only invocable methods are find|filter|map|flatMap')
        },
        set(){
            throw new Error('Proxy cannot be mutated in this context')
        }
    })

    return { 
        proxy,
        path
    }
}

let paths = new Map<String, Path>;
function useState<T>( state: T) : UsedState<T>
function useState<T>( state?: T) : UsedState<T, T | undefined> {

    const staticPathChildren = new Map<string, Set<UsedState<unknown>>>;
    const signal_directWrite = S.data<typeof state>()
    const signal_childUpdated = S.data<any>()

    function set(x: T | (( x:T extends undefined ? T | undefined : T ) => T ) ){
        signal_directWrite(x as T)
    }

    // if state is written to, we cache it
    S.computation(() => {
        state = signal_directWrite()
    })

    // subscribe to either signal, return cached value
    let get = S.computation(() => {
        signal_directWrite()
        signal_childUpdated()

        return state
    })

    function use<W>( fn: ((x: T) => W) ) : UsedState<W> {

        const signal_directWrite = S.data<W>()
        const signal_childUpdated = S.data<any>()

        let path = S.xet(paths, fn+'', () => {

            const recorder = Recorder()
            
            fn( recorder as unknown as T )

            return recorder.path
        })

        // this recomputes the parent from scratch
        // we try not to do this unless something changed
        // in an ancestor
        function getParentReference(){
            if ( staticPath.length === 0 ) {
                return state;
            } else {

                let prev = state;
                for ( let it of path ) {
                    if (prev == null) break;
                    if ( it.tag == 'get' ) {
                        prev = (state as any)?.[it.value]
                    } else {
                        let ot = it;

                        let out = (prev as any[])[it.tag as any](
                            (x:any) => ot.value(x)
                        )

                        prev = out
                    }
                }

                return prev;
            }
        }

        return null as unknown as UsedState<W>
    }


    function accessor(...args: any[]){
        if ( args.length ) {
            return (set as any)(...args);
        } else {
            return get()
        }
    }
    accessor.use = use
    
    return accessor as unknown as UsedState<T, T | undefined>;
}


// Like S.data
let id = useState('dog');

// same again
let animals = useState([{ name: 'Dog', id: 'dog' }, { name: 'Cat', id: 'cat' }])

// but we can focus our state and get a new getter/setter
let animal = animals.use( x => x.find( x => x.id === id() )! )

// and we can focus that focused state futher
let name = animal.use( x => x.name )

// behind the scenes we're generating a query that focuses on state
// and these queries can have multiple results
// usually we want the first result so we do that by default

animals()

// but if we want the full result set we can get it like so
animals.all()

// in the above case its a nested array because the value itself was an array


// if we subscribe to animals

useEffect(() => {
    animals()
})

// and we update name, the above effect will run because we automatically
// are subscribed to any downstream streams...

// and if we subscribed to name, and replaced the animals list, this effect would run
// because if the parent updated, children need to propagate
useEffect(() => {
    name()
})

// unlike other libraries, we do not differentiate between values and events, if you
// write the same value to a setter twice, every dependency will emit twice
// this is to make the library faster and less magic

// with the above name example, if some other child of animals like animal.age changed
// name won't emit, because it is not an ancestor of name
// and if some other section of state propagates, name again will not propagate
// this works as you'd probably expect it to
// if setting a stream _could_ have changed another stream, it will emit, if it is impossible
// for that write to update a stream, it won't

// type Value = object | any[]
// function Z<State extends object>(state: State){
    

//     function useState<Request=State, Response extends Value>( visitor: (state: Request) => Response ) : Response {

//         type F = typeof useState
//         return null as unknown as ( visitor: ( state: Resonspse ) =>  );
//     } 

//     return { useState }
// }


// let useState = Z({
//     animals: [
//         { name: 'Dog', id: 'dog', rating: 1 },
//         { name: 'Cat', id: 'cat', rating: 1 },
//         { name: 'Bird', id: 'bird', rating: 1 },
//     ]
// })


// let id = S.data<string>();

// // this records the path state.animals.name, and records a predicate runs on animals
// // we set up a computation and when it runs, we no we have to re-evaluate the cached
// // value for this stream
// // due to the path we know we also need to re-run if state.animals is written too, or if state is written too
// // if a child of state is updated, like state.foods, it doesn't affect this computation
// // if state.animals.age updates we have to re-evaluate this stream because we don't know if it affects
// // the filter
// //
// // if state or state.animals updates but wasn't directly updated, it isn't a trigger, e.g. 

// const name = useState( 
//     state => state.animals.filter( x => x.id === id() ).map( x => x.name )
// )