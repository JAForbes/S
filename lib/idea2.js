// user can do whatever they like in the query fn
// we track the value and the dependencies as it is evaluated
// at the end we have a list of dependencies and a resolved value
// we then subscribe to those dependencies direct writes
// if they are updated, we re-run the entire process including dependencies
// because of conditional paths
//
// our proxy needs to behave like real JS
// and if the user returns a value that isn't our proxy
// we have to run with it, maybe the resolved value is a computed value not a raw state value
//
// because of conditional branching and S' auto tracking, our query dependencies can't be analyzed
// without having access to real state values, in other words, it can't be purely symbolic

let raw = Symbol.for("JAForbes/S::raw");
function query(visitor, state){
    let result = visitor(new PathProxy({ parent: state }))

    let x = raw in Object(result) ? result[raw] : { parent: result}

    return x
}

let initialState = { 
    users: [
        {
            id: 'barney',
            profile: {
                lastUpdatedAt: 100,
                avatar: 'twitter.jpg',
                friends: [
                    { id: 'james' }
                ]
            }
        },
        {
            id: 'james',
            profile: {
                lastUpdatedAt: 100,
                avatar: 'github.jpg',
                friends: [
                    { id: 'barney' }
                ]
            }
        }
    ]
}

// x
// x.users
// x.users.*.id
// x.users.*.friends
// x.users.*.friends.length

let hardQuery = x => {
    const user = 
        x.users.find( x => x.id === 'barney' )

        
    let i = Math.floor(user.profile.friends.length -1 * Math.random())
    

    let otherId = user.profile.friends[i].id

    let otherUser = 
        x.users.find( x => x.id === otherId )
    
    return otherUser;
}

const simpleQuery = x => 
    x.users.find( x => x.id == 'barney'  ).id

let c$ = query( hardQuery, initialState)


console.log(c$.parent)
function PathProxy({ target=(() => {}), path=[], parent=null, grandParent=null }){

    let p = new Proxy(target, {
        get(target, key){
            if ( key === Symbol.toPrimitive ) {
                return () => {
                    return parent
                }
            }
            if ( key === raw ) {
                return { target, path, parent }
            }

            // if parent is null, continue traversing to gather dependencies
            // but our final resolved value will be null
            if ( parent == null || parent[key] == null ) {
                return PathProxy({ path: path.concat(key), grandParent: parent })
            }

            if ( Object(parent[key]) !== parent[key] ) {                
                return parent[key]
            } else {
                return PathProxy({ 
                    path: path.concat(key)
                    , parent: parent[key]
                    , grandParent: parent 
                })
            }

        },
        has(_, key, receiver) {
            if (key === raw ) {
                return true
            }

            return Reflect.has(parent, key, receiver)
        },
        apply(target, thisArg, argArray){
            let result;

            if ( 
                parent === [].map 
                || parent === [].flatMap 
                || parent === [].filter 
                || parent === [].find
            ) {
                
                result =  parent.call( 
                    grandParent.map( x => PathProxy({ parent: x, path }))
                    , argArray[0] 
                )

            } else {
                result = target.apply(grandParent, argArray)
            }

            if ( result == null ) {
                return PathProxy({ path })
            } else {
                return result
            }
        }
    })

    return p
}