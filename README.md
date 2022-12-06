# S.js

This is me reimplementing S.js from first principles to try and understand it.

Please do not use this in anything, its likely to change at a moments notice.

## What is S even?

A library that let's you write code that automatically updates when any referenced dependencies emit a new value.

```js
const second = S.data(1);
setInterval(() => second((x) => x + 1));

S.computation(() => {
  second();
  console.log("I will rerun every second");
});
```

The [original S.js](https://github.com/adamhaile/S) was written by Adam Haile. Adam's implementation is fast and the API surface is small but powerful.

S is both similar and different to other stream libraries you may have heard of like Rx.js, xstream, most.js, flyd. But in these libraries streams have explicit dependencies whereas in S dependencies are automatically tracked.

Both approaches and strengths and weaknesses, but automatic dependency tracking has had a bit of a resurgence in reactive view frameworks like Vue.js, Solid.js, Preact. The most famous example of auto dependency tracking would be Knockout.js

Why do all these mentioned frameworks use auto dependency tracking? It turns out works really well for efficiently rendering UIs because some nested component can reference something without knowing it is even being tracked. This allows for a separation of concerns that works very well in user interface programming.

For some diatribing on why this rewrite exists and other differences between the original S.js and this lib, check out the end of this README.md

## Terminology

### Signal

We'll use the term signal, which is the same thing as a `stream`, an `observable` and an event emitter.

From time to time you may see the term `stream` used instead of `signal`, but it is all the same thing.

### Tick

Each time a signal emits a new event all dependent computations on that signal need to re-run, and all computations that rely on those computations also need to re-run and so on...

The process of updating these dependencies to have their new values is called a tick. What makes S.js special compared to other libraries is what happens when one tick triggers writes that need their own new ticks to run. In S.js, those new writes are deferred until the end of the current update cycle. Then a new tick starts that includes all the dependencies of all the writes that were deferred.

Each update is discrete, and that makes debugging easier. Each discrete update is called a "tick".

You can prevent a tick from starting immediately by using `S.freeze`. If you write to a signal while you already in a tick, you are effectively writing with an S.freeze block, where the updates are deferred until the next update.

## API Documentation

### `S.root`

Creates an isolated disposable context that allows you to manually clean up S signals. When nested you can isolate signals from being cleaned up when the parent root is disposed.

```js
S.root((dispose) => {
  let a = S.data(1);

  S.computation(() => {
    console.log(a());
  });

  setInterval(() => {
    a((x) => x + 1);

    if (a() > 10) {
      // we'll be able to write to a, but the above
      // computation will not log anymore
      dispose();
    }
  });
});
```

> 💡 In the original S this would throw, we know do not enforce this. But we might bring it back if we find it is useful.

### `S.data`

Creates a signal. When writing to a signal, any computations that referenced that signal will re-run.

```js
const age = S.data(15);

age();
// 15

age(16);

age();
// 16

age((x) => x + 10);
// 26
```

`S.data` will emit any time you write to it, it will not diff values and prevent emits if you write the same value twice, but it will throw a `Conflict` error if you set two different values within the same tick.

### `S.computation`

A computation is a read only signal that depends on other signals. A computation can depend on other computations and data signals (`S.data`).

```js
S.computation(() => {
  console.log("age is", age());
});

age(1);
// Logs: age is 1

age(1);
// Logs: age is 1
```

A computation can return a value, and then that can be accessed via invocation.

```js
let a = S.data(20);
let b = S.computation(() => {
  return a() + 10;
});

b();
// 30

a(40);
b();
// 50
```

A computation can access its previous value, and if you pass in a seed value as a second argument the previous value is guaranteed to not be undefined on the first invocation.

```js
let count = S.computation((prev) => {
  return prev + inc();
}, 0);

count();
// 0
inc(1);

count();
// 1

inc(1);
inc(1);
inc(1);

count();
// 4
```

### `S.generator`

The super power of this rewrite. `S.generator `is exactly like `S.computation` but it allows you to have async resumable computations.

```js
const thumbnail = S.generator(function* () {
  let breed = dogBreed();
  let [pic] = yield fetch(
    baseURL + "/dogs/pictures/breed/" + breed + "?limit=1"
  ).then((x) => x.json());

  let thumbnail = yield fetch(
    baseURL + "/dogs/pictures/thumbnail/" + pic.id + `?size=${thumbnailSize()}`
  );

  return thumbnail;
});

S.computation(() => {
  // use the thumbnail when its resolved
  console.log(thumbnail());
});
```

The above code will re-run any time `dogBreed` or `thumbnailSize` signal changes. If an existing instance of this computation is already running, it will be cancelled. You can observe the cancellation by using a `try {...} finally {...}` block.

> 🤔 Why not use async / await? Unlike `async` functions, generators can be suspended and resumed. This allows us to track which generator context is active when a signal is referenced even if there's async code in between reads. Also generators are cooler than async / await, time we all accepted that.

Currently a new instance of a generator cancels the old one, after dogfooding this a bit we may decide to expose options that allows you to specify what happens to the old instance when a new one starts.

### `S.id`

Returns a consistent random identifier for a given signal or computation to help with representing distinct memory references in a string.

```js
const a = S.data(1);

S.id(a); // kjhjkgasd
S.id(a); // kjhjkgasd

const b = S.data(1);

S.id(b); // kllkhasda
S.id(a); // kjhjkgasd
```

This id is not globally unique, or cryptographically random, its just a debugging thing.

### `S.sample`

Read the value of a signal within a computation without treating it as a dependency of that computation.

```js
S.computation(() => {
  // will re-run when b changes, but not when a changes
  return S.sample(a) + b();
});
```

### `S.freeze`

Batch up multiple writes and only trigger a tick at the end of the freeze block.

```js
S.freeze(() => {
  a(1); // no tick yet
  b(3); // no tick yet
  c(10); // no tick yet
});
// now the tick runs
```

If you call `freeze` when time is already frozen it has no additional effect.

### `S.cleanup`

After the first run, every time a computation runs any cleanup hooks will re-run. This is helpful for imperative stateful APIs like `setTimeout` / `clearTimeout` or `addEventListener` / `removeEventListener`

```js
S.computation(([oldElement, oldCallback]) => {
  let element = domElement();

  S.cleanup(() => {
    oldElement.removeEventListener("click", oldCallback);
  });

  let callback = () => console.log("someone clicked me", element);

  element.addEventListener("click", callback);

  return [element, callback];
}, []);
```

---

## Motivation for rewriting

I wanted to build a lot of higher level abstractions on top of S, but the fact the original library seems to not be actively maintained, and the fact other libraries like Solid have their own forks make me feel I needed to at least write it from scratch to understand it enough to de-risk the lack of maintenance on the original library.

Now I've rewritten it, I feel confident in maintaining this myself while building on top of it.

## Why not just use Solid / sinuous etc?

Those libraries are great, but they are exploring a different problem domain. I want to explore and prioritize things other libraries likely won't. But I think we can all learn from each other by exploring this space together by following our own interests.

For example, I'm not that interested in SSR or hydration. But I'm very glad others are thinking about that and proving out that space. I feel like we're still in the dark ages with state management and routing and I'd really like to explore more database inspired approaches in SPA's. Maybe we can all learn from each other and steal each other's best ideas!

Re: databases, I'm very interested in "updatable views", store APIs that operate on sets, query languages, and sitting that on top of closer to metal the DOM view abstractions. My philosophy is that it is ok to expect an end user to learn some upfront concepts if doing so will pay off for them significantly.

I think libraries like React take an alternative approach where they want to hide the complexity from the developer by creating many layers of abstraction.

The problem is, the new abstractions end up being as complicated as the ones that were intended to be obscured. In some cases it's a valid trade off, because the new abstraction layer is at least yours to control, but it prioritizes one audience over another and leads to some long term platform lock in.

I think Solid is great because it is so familiar for React dev's, it leans into that familiarity, you have context, you have a hook like API, you have refs. I really look forward to the day we can all write Solid.js code professionally instead of React.js, I want it to be that mainstream contender. But there should also be alternatives that maybe don't have the same reach but allow people who really know the DOM / JS / S APIs to build simpler apps because of the thin layer of affordances provided.

## Differences from the original S.js

When I original wrote this, it was really just a learning project. But now I feel I've got a grasp of how it works I plan to be more opinionated about the API surface as I intend to use it for other things.

Not all features in the original S.js are included, and this library has some features the original doesn't have.

Some things this library doesn't include:

- `S.value`
- `S.on`
- `S.subclock`

Both `S.value` and `S.on` are easy to add in userland, and I'm not sure if `S.subclock` is useful (yet).

Some things this library has that the original didn't have

- `S.generator`
- `S.id`

`S.generator` is a must have for the kind of state management work I want to be doing. `S.id` is needed to help caching in higher level abstractions, but is also helpful for debugging.

## Differences in Internal Architecture

I didn't study how S worked internally, I tried to follow the code a few times and just tied myself in knots. Instead I worked from the documentation and test suite and wrote a clean room implementation based on my understanding at the time. As I understood the reason for different design decisions more I adjusted my implementation.

This wasn't the most efficient way to do it, but it seemed to be the only way I could wrap my head around the API.

Over the past few months there's been a lot of "aha!" moments where I gradually started to understand the point of some of the design decisions, that will likely continue for some time!

I imagine the original S.js is faster than this implementation and probably has optimizations on hot paths that this library doesn't yet have. But I think this architecture is very simple and easy to iterate on. For my needs that is the highest priority.

We've basically got a bunch of `Map`'s and `WeakMap`'s that track different states. E.g. things that are scheduled to run, nodes that depend on other nodes, cleanups that should run when a computation next runs, the stack of active computations, signals that have values to resolve at the end of a transaction, signals that should be written in the next tick, parents of signals, children of signals.

Once you understand those collections, the rest sort of falls into place, the code doesn't do much more than you'd expect.

There is a few surprising code paths, but hopefully they could be modelled as collections too and unified as this implementation matures.

## Contributions?

I really like to worry about surface API way way late in the game. I want to work with the grain of the underlying technology and let it tell me what it wants to be, so that is largely mutually exclusive with the open source model.

I'm iterating on various ideas with @barneycarroll and when we've bashed out a few more prototypes and formed a solid thesis of what we're even doing then it'd be great to encourage people to use and contribute to this and other libraries that we're working on.

But for now, best to watch from a distance.

## Undocumented Features

For learning / debugging almost everything from the internals is temporarily exported. Relying on anything that isn't documented will lead to highly unstable caller code so do not assume an export is officially part of the public API.
