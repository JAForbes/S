# Store

> 💣  Do not use this.  The API is going to constantly change while we dogfood it.

## What

A higher level relational API that sits on top of S which supports bi-directional/isomorphic querying of state.

What does that all mean?  You can query a store and target more than one thing at once, and read and write to the same objects with the same query.

The store API is fully typed, so querying is fun and safe.

## Concepts

As this library matures we'll probably move this section into a separate documentation, but the people who will initially be using this need to understand the internals more than a casual user so it is front and center for now.

### Relational

This library operates on sets instead of single items.  This is pretty unique in the JS state management world.  But by operating on sets we get to take advantage of relational algebra.  No null checks needed as a transform on an empty set is a no-op.  And we can have a single query that reads and writes multiple values.  Think of easily updating all the state for todo items matching a filter.

The queries are also reactive, so you can define them before data arrives and listen to changes (cool right?)

### Cached Queries

This library caches queries so if you write a query in a loop, it will not recreate the query on each subsequent iteration.

The caching relies on a computed key for each query segment.  It is pretty reliable but its not fool proof.

The biggest weakness of this approach is custom predicate functions rely on the `function::toString()`

So if you have some closured dependency that is different in two contexts you might get surprising results.

It's not as bad as it sounds though because the key includes the fully qualified path and the store name so usually if its the same key, its the same query.

Additionally if you write two queries that function do the same thing but have different white space, or operations were applied in a different order, you won't have a cache hit.

So why even cache if you have all these drawbacks?  We want to encourage querying in live computations and areas that activate on re-render.

## How does it work?

For every store this is one root store that allows you create child stores.

The root store maintains the state, and the child stores are reactive views on that state.

Anytime a write happens on a child store we convert it to a write on the root store (using function composition).

We also batch writes into a single tick by detecting if a tick is already in progress and deferring new writes for the next tick (just like S does).

The child stores are created by an internal function `createChildStore` function that requires a read and write function.  The read function returns a set and the write function takes the parent and an update visitor that is applied to the appropriate items on the parent.

```js
// a simplified example
const prop = createChildStore(
    // getter returns a set of 1 (in this case)
    row => [row[key]] 

    // setter applies the update visitor function to the child 
    // property
    , (parent, update) => ({ ...parent, [key]: update(parent[key])})
    
)
```

> 🤫 This is basically a lens, but don't tell anyone... that is also why `focus` is so named.

The child store creates an `S.computation` that maps over the parent store's result set and runs the read function over each item and flatMaps it into 
its own result set.

If the immediate parent emits with the same reference equality for all results in the result set, the child will not emit.  This allows you to subscribe to changes anywhere in the tree while not worrying about unnecessary updates.

When a write happens, we notify the immediate parent with our setter, the immediate parent composes the child setter with its own setter, this repeats until you reach the root store and the patch is applied to an in memory copy immediately.  If no tick is running, this new store state is written to the internal S signal, if not it is deferred until the tick ends.

So summing up, you get a reactive state tree that operates on sets.  Internally each child store uses a getter and a setter to allow isomorphic read/write.  Writes are batched much like S and as reactivity relies on S you can mix and match the store API with normal signals.

## API

The current API is intentionally a bit verbose, we're dogfooding this in a few projects and its easier to go in different directions if we expose only the lowest level primatives initially.

There's a lot of sugar we could apply with proxies, more utilities, more terse naming, but we can do all that later.

### Quick Start

```js
import * as Store from 'jaforbes-s/store.js'
import * as S from 'jaforbes-s'

const store = Store.createStore('myStore', [
    users: [],
    projects: []
])

const user_id = store.prop('user_id')

const user = 
    store
        .prop('users')
        .unnest()
        .filter( x => x.user_id === user_id.read() )

S.computation(() => {
    console.log('user', user.read())
})

user_id.write(() => 1)
// logs 'user undefined'

store.users.write(() => [
    { id: 1, name: 'Billy' },
    { id: 2, name: 'Zoe' },
    { id: 3, name: 'Franco' }
])
// logs "user { id: 1, name: 'Billy' }"

user.read()
// { id: 1, name: 'Billy' }

user.readAll()
// [{ id: 1, name: 'Billy' }]
```

### `createStore`

```typescript
type createStore = (name: string, T[]) => Store<T>
```

Creates a store, we currently make name mandatory to help with debugging.  You also need to pass in an array, think of it as a table instead of a single state tree.  We could do it for you but then the API might be ambiguous when a specific item in a result set happens to be a list... 🙀

### `store.prop`

```typescript
interface Store<T> {
    prop = <U>(name: keyof T) => Store<U>
}
```

Creates a child store that focuses on a child property.

### `store.unnest`

```typescript
type Unnest<T> = T extends Array<any> ? T[number] : never;

interface Store<T> {
    unnest = <T>() => Store<Unnest<T>>
}
```

Lifts a result set of arrays into a result set of values.  Inspired by postgres' [unnest](https://www.postgresql.org/docs/14/functions-array.html)

### `store.filter`

```typescript
type Predicate = <T>(x:T) => boolean

interface Store<T> {
    filter = (f: Predicate<T>) => Store<T>
}
```

Filters a result set based on a predicate.  If your store is focused on a list, note this doesn't filter the items in the list.  If you want to filter based on items in the array use `.unnest().filter( x => ... )`

### `store.read`

```typescript
interface Store<T> {
    read: (): T?
}
```

Reads the current value for a given store and takes the first item from the result set.  If used in a reactive context (e.g. an `S.computation`) this will be registered as a dependency in the parent reactive context.

If you want to read the value but not register it as a dependency, use `.sample()` instead.

### `store.readAll`

```typescript
interface Store<T> {
    readAll: (): T[]
}
```

Like `store.read` but returns the complete result set for the given store.  This is useful when you're targeting a set, or when you want to[ avoid dealing with undefined values](https://james-forbes.com/posts/versatility-of-array-methods).

### `store.sample`

```typescript
interface Store<T> {
    sample: (): T?
}
```

Like `store.read` but does not register the store as a depedency of the parent reactive context.

### `store.sampleAll`

```typescript
interface Store<T> {
    sampleAll: (): T[]
}
```

Like `store.readAll` but does not register the store as a depedency of the parent reactive context.

### `store.write`

```typescript
interface Store<T> {
    write: (f:((a:T?) => T)): T
}
```

Updates the value of the store.  When used on the root store, directly applies your update.  When used on a child store, your write function is composed with parent transforms to transform the root store immutably.

If an update to the store is already in progress when this write occurs, this write and other writes are scheduled to run together in the next tick.

### `store.getReadStream`

```typescript
interface Store<T> {
    getReadStream(): Signal<T[]>
}
```

Returns the raw S signal for the given store.

### `store.path`

```typescript
interface Store<T> {
    path: string[]
}
```

Returns the list of caching keys for each segment in your query.

### `store.focus`

```typescript
interface Store<T> {
    focus<U>(
		get: (row: T) => U[] | [],
		set: (state: T, update: ( (row:U) => U) ) => T,
    ): Store<U>
}
```

A pretty low level but useful operation.  This what powers creating a child store.  You provider a getter that returns a set, and a setter that takes the parent state and runs an update function on that state.