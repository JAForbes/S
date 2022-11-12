# S.js

This is me reimplementing S.js from first principles to try and understand it.

Please do not use this in anything, its likely to change at a moments notice.

## Terminology

### Signal

We'll use the term signal, which is the same thing as a `stream`, an `observable`, an event emitter.

From time to time you may see `stream` used instead of `signal`, but its all the same thing.

### Tick

If some computations are updating because you wrote to a signal, and in one of those computations you write to a different signal, that second write is scheduled to run when the current propagation of updates completes.

Each time you write, there is a set of dependencies that need to update, and that is computed ahead of time.  That dependency list will not change if you are currently in the process of updating, instead those new dependencies are scheduled to run in a new update that will happen immediately after the current update.

Each of these update phases is called a "tick".

You can prevent a tick from starting immediately by using `S.freeze`.  If you write to a signal while you already in a tick, you are effectively writing with an S.freeze block, where the updates are deferred until the next update.

> 🤔 Ok, but why?  In other stream libraries you can end up in very complicated debugging scenarious where a complex has overlapping dependency trees and they will trigger infinite propagations in unexpected ways.  This process of having distinct scheduled batches of updates gives us a fighting chance when debugging those runaway propagations.

## Documentation


### `S.root`

Creates an isolated disposable context that allows you to manually clean up S signals.  When nested you can isolate signals from being cleaned up when the parent root is disposed.

```js
S.root((dispose) => {

    let a = S.data(1)

    S.computation(() => {
        console.log(a())
    })

    setInterval(() => {
        a( x => x + 1 )

        if (a() > 10) {
            // we'll be able to write to a, but the above
            // computation will not log anymore
            dispose()
        }
    })

    
})
```

> 💡 For now, it is mandatory to have at least one `S.root` context before creating a computation.  This may be dropped latter as in many situations its redundant.

### `S.data`

Creates a signal.  When writing to a signal, any computations that referenced that signal will re-run.

```js
const age = S.data(15)

age()
// 15

age(16)

age()
// 16

age( x => x + 10 )
// 26
```

`S.data` will emit any time you write to it, it will not diff values and prevent emits if you write the same value twice, but it will throw a `Conflict` error if you set two different values within the same tick.

### `S.computation`

A computation is a read only signal that depends on other signals.  A computation can depend on other computations and data signals (`S.data`).

```js
S.computation(() => {
    console.log('age is', age())
})

age(1)
// Logs: age is 1

age(1)
// Logs: age is 1
```

A computation can return a value, and then that can be accessed via invocation.

```js
let a = S.data(20)
let b = S.computation(() => {
    return a() + 10
})

b()
// 30

a(40)
b()
// 50
```

A computation can also access its previous value, you can also pass in a seed value as a second argument to ensure the previous value is not undefined on first invocation.

```js
let count = S.computation(prev => {
    return prev + inc()
}, 0)

count()
// 0
inc(1)

count()
// 1

inc(1)
inc(1)
inc(1)

count()
// 4
```

### `S.generator`

The secret sauce of this library.  `S.generator `is exactly like `S.computation` but it allows you to have async resumable computations.

```js
const thumbnail = S.generator(function * (){
    let breed = dogBreed()
    let [pic] =
        yield fetch(baseURL+'/dogs/pictures/breed/'+breed+'?limit=1')
        .then( x => x.json() )

    let thumbnail = 
        yield fetch(baseURL+'/dogs/pictures/thumbnail/'+pic.id+`?size=${thumbnailSize()}`)

    return thumbnail
})

S.computation(() => {
    // use the thumbnail when its resolved
    console.log( thumbnail() )
})
```

The above code will re-run any time `dogBreed` or `thumbnailSize` signal changes.  If an existing instance of this computation is already running, it will be cancelled, you can inspect the cancellation by using a `try {...} finally {...}` block.  

> 🥸 Why not use async / await?  Unlike `async` functions, generators can be suspended and resumed.  This allows us to track which generator context is active when a signal is referenced even if there's async code in between reads.  Also generators are cooler than async / await, time we all accepted that.

Currently a new instance of a generator cancels the old one, after dogfooding this a bit we may decide to expose options that allows you to specify what happens to the old instance when a new one starts.

### `S.id`

Returns a consistent random identifier for a given signal or computation to help with representing distinct memory references in a string.

```js
const a = S.data(1)

S.id(a) // kjhjkgasd
S.id(a) // kjhjkgasd

const b = S.data(1)

S.id(b) // kllkhasda
S.id(a) // kjhjkgasd
```

This id is not globally unique, or cryptographically random, its just a debugging thing.

### `S.sample`

Read the value of a signal within a computation without treating it as a dependency of that computation.

```js
S.computation(() => {

    // will re-run when b changes, but not when a changes
    return S.sample(a) + b()
})
```

### `S.freeze`

Batch up multiple writes and only trigger a tick at the end of the freeze block.

```js
S.freeze(() => {
    a(1) // no tick yet
    b(3) // no tick yet
    c(10) // no tick yet
})
// now the tick runs
```

If you call `freeze` when time is already frozen it has no additional effect.

### `S.cleanup`

After the first run, everyime a computation runs any cleanup hooks will re-run.  This is helpful for imperative stateful APIs like `setTimeout` / `clearTimeout` or `addEventListener` / `removeEventListener`

```js

S.computation(([oldElement, oldCallback]) => {

    let element = domElement()

    S.cleanup(() => {
        oldElement.removeEventListener('click', oldCallback)
    })

    let callback = () => console.log('someone clicked me', element)
    
    element.addEventListener('click', callback)

    return [element, callback]
}, [])
```

---


## Motivation for rewriting

I co-own a company that builds apps and software both for our own use and for clients use.  I wanted to build a lot of higher level abstractions on top of S, but the fact the original library seems to not be actively maintained, and the fact other libraries like Solid have their own forks make me feel I needed to at least write it from scratch to understand it enough to de-risk the lack of maintenance on the original library.

Now I've rewritten it, I feel confident in maintaining this myself while building on top of it.

## Why not just use Solid / sinuous etc?

Those libraries are great, but they are exploring a different problem domain.  I want to explore and most want to prioritize things other libraries likely won't.  But I think we can all learn from eachother by exploring this space together by following our own interests.

For example, I'm not that interested in SSR or hydration.  But I'm very glad others are thinking about that and proving out that space.  I feel like we're still in the dark ages with state management and routing and I'd really like to explore more database inspired approaches in SPA's.  Maybe we can all learn from eachother and steal eachother's best ideas!

Re databases, I'm very interested in "updatable views", store APIs that operate on sets, query languages, and sitting that on top of closer to metal the DOM view abstractions.  My philosophy is that its ok to expect an end user to learn some upfront concepts if doing so will pay off for them significantly.  I think libraries like React take an alternative approach where they want to hide the complexity from the developer by creating many layers of abstraction, the problem is, it never ends and the new abstractions end up being more complicated than the ones that were designed to be obscured.  In some cases it's a valid trade off, because the new abstraction layer is at least yours to control, but it prioritizes one audience over another and leads to some long term platform lock in.

I think Solid is great beacuse it is so familiar for React devs, it leans into that familiarity, you have context, you have a hook like API, you have refs.  I really look forwrad to the day we can all write Solid.js code professionally instead of React.js, I want it to be that mainstream contender.  But there should also be alternatives that maybe don't have the same reach but allow people who really know the DOM / JS / S APIs to build simpler apps because of the thin layer of affordances provided.

## Differences from the original S.js

When I original wrote this, it was really just a learning project.  But now I feel I've got a grasp of how it works I plan to be more opinionated about the API surface as I plan to use it for other things.

So not all features in the original S.js are included, and this library has some features the original doesn't have.

Some things this library doesn't include:

- S.value
- S.on
- S.subclock

Some things this library has that the original didn't have

- S.generator
- S.id

I'm also not sure if S.root should be mandatory, so in the near future we may drop that and assume you know what you're doing.

## Differences in Internal Architecture

I didn't study how S worked internally, I tried to follow the code a few times and just tied myself in knots.  Instead I worked from the documentation and test suite and wrote a clean room implementation based on my understanding at the time.  As I understood the reason for different design decisions more I adjusted my implementation.

Over the past few months there's been a lot of "aha!" moments where I gradually started to understand the point of some of the design decisions, that will likely continue for some time!

I imagine the original S.js is faster than this implementation and probably has optimizations on hot paths that this library doesn't yet have.  But I think this architecture is very simple and easy to iterate on.

We've basically got a bunch of maps and weakmaps that track different states.  E.g. things that are scheduled to run, nodes that depend on other nodes, cleanups that should run when a computation next runs, the stack of active computations, signals that have values to resolve at the end of a transaction, signals that should be written in the next tick, parents of signals, children of signals.

Once you understand those collections, the rest sort of falls into place, the code doesn't do much more than you'd expect.

There is a few suprising code paths, but hopefully they could be modelled as collections too and unified as this implementation matures.

## Contributions?

I really like to worry about surface API way way late in the game, I want to work with the grain of the underlying technology and let it tell me what it wants to be, so that is largely mutually exclusive with the open source model.

I'm iterating on various ideas with @barneycarroll and when we've bashed out a few more prototypes and formed a solid thesis of what we're even doing then it'd be great to encourage people to use and contribute to this and other libraries that we're working on.

But for now, best to watch from a distance.
