import * as Store from '../lib/store.js'
import * as S from '../lib/index.js'
import test from 'tape'
type User = { id: number, name: string, tags: string[] }
type Project = { id: number, name: string }

test('caching', t => {

    Store.root((dispose) => {
        let store = Store.createStore('@', [{
            a: {
                b: {
                    c: {}
                }
            }
        }])
    
        let a1 = store.prop('a')
        let a2 = store.prop('a')

        t.strictEquals(a1, a2, 'a == a')

        t.strictEquals(
            store.prop('a').prop('b').prop('c'),
            store.prop('a').prop('b').prop('c'),
            'a.b.c == a.b.c'
        )

        t.equals(
            store.prop('a').filter( () => true ).prop('b').focus( x => [x], (o,b) => ({ ...o, b })).path.join('.'),
            '@.a.filter(() => true).b.focus(x => [x])',
            'path for complex queries work as expected'
        )
        
        dispose()
    })

    t.end()
})

test('propagation', t => {
    Store.root((dispose) => {
        let store = Store.createStore('@', [{
            organizations: [
                { organization_id: 1 },
                { organization_id: 2 },
            ],
            schedules: [
                { schedule_id: 1, organization_id: 1 }
                , { schedule_id: 2, organization_id: 2 }
                , { schedule_id: 3, organization_id: 1 }
                , { schedule_id: 4, organization_id: 2 }
            ],
            projects: [
                { project_id: 1, schedule_id: 1, organization_id: 1 },
                { project_id: 2, schedule_id: 2, organization_id: 2 },
                { project_id: 3, schedule_id: 3, organization_id: 1 },
            ],
            organization_id: 1,
            schedule_id: 1 as number | null,
            project_id: 1 as number | null,
        }])

        const schedule_id = store.prop('schedule_id')
        const organization_id = store.prop('organization_id')
        const project_id = store.prop('project_id')
    
        const project =
            store
            .prop('projects')
            .unnest()
            .filter( x => x.organization_id != null && x.organization_id == organization_id.read() )
            .filter( x => x.schedule_id != null && x.schedule_id == schedule_id.read() )
            .filter( x => x.project_id != null && x.project_id == project_id.read() )
        

        S.computation(() => {
            console.log('project.read()', project.read())
        })

        // store.prop('schedule_id').setState( x => x )
        store.prop('schedule_id').setState( () => 3 )
      
        S.freeze(() => {
            store.prop('schedule_id').setState( () => 3 )
            store.prop('project_id').setState( () => null )
            // store.prop('organization_id').setState( () => null )
        })
        dispose()
    })

    t.end()
})

// currently freeze crashes because for every write we get a new result set
// and each result set is a new memory reference, so S rightfully thinks
// we're setting two different values for the same tick
// 
// I think the solution is to not store the result set in the signal
// but instead have multiple signals, one for each row in the result set
//
// I'm not sure what the ramifcations of this are, but it feels like
// the right approach because then there's no special equality rules
// and no tight coupling between S and the store
// not that tight coupling would be bad, but alternatives should be explored
// first
//
// I think we can have a signal that manages the other signals, so if
// the count changes a new signal can be created/destroyed
// this might actually make the propagation more granular too which would
// be cool
//
// also considered special equality functions, disabling conflicts
// batching changes
// maybe reusing the result set reference if the length/order hasn't changed
// tried it... won't work for unnest as we can't mutate the real row data
// 
// all have drawbacks
//
// test('freeze', t => {
    // S.freeze(() => {
    //     store.prop('schedule_id').setState( () => 3 )
    //     store.prop('project_id').setState( () => null )
    //     // store.prop('organization_id').setState( () => null )
    // })

// })

// test('store', t => {

//     Store.root(() => {

//         let store = Store.createStore('@', [{
//             users: [] as User[],
//             projects: [] as Project[]
//         }])

//         let usersStore = store.prop('users')
        
//         let projectsStore = store.prop('projects')

//         let user_id = S.data(1)
//         let project_id = S.data(2)

//         usersStore.setState( () => [{ id:1, name: 'James', tags: ['red'] }, { id:2, name: 'Emmanuel', tags: ['blue'] }, { id: 3, name: 'Jack', tags: ['red']}])
//         projectsStore.setState( () => [{ id:1, name: 'NSW456'}, { id:2, name: 'QLD123'}])


//         let userStore = usersStore.whereUnnested({ "id": user_id })

//         let projectStore = projectsStore.whereUnnested({ "id": project_id })

//         const nameStore = userStore.prop("name")

//         S.computation(() => {
//             console.log('store.read', store.read())
//         })
//         S.computation(() => {
//             console.log('usersStore.read', usersStore.read())
//         })
//         S.computation(() => {
//             console.log('projectsStore.read', projectsStore.read())
//         })
//         S.computation(() => {
//             console.log('projectStore.read', projectStore.read())
//         })
//         S.computation(() => {
//             console.log('userStore.read', userStore.read())
//         })

//         console.log('updating name store')
//         nameStore.setState(() => 'John')

//         const redUsers = store.prop('users')
//             .unnest()
//             .filter( x => x.tags.includes('red') )

        
//         redUsers.prop('name').setState( x => x + '!')
//         console.log(redUsers.sampleAll())
//         console.log(store.sample().users)

//     })
//     t.end()
// })