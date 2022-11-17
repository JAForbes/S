import * as Store from '../lib/store.js'
import * as S from '../lib/index.js'
import test from 'tape'
type User = { id: number, name: string, tags: string[] }
type Project = { id: number, name: string }

import * as U from '../lib/utils.js'

test('dropRepeats', t => {

    let emits : [string,number][] = []
    S.root(() => {
        let a = S.data(0)
        let b = U.dropRepeatsWith(a, (a,b) => a === b)

        S.computation(() => {
            emits.push(['a', a()])
        })
        S.computation(() => {
            emits.push(['b', b()])
        })

        a(0)
        a(0)
        a(1)
    })

    t.deepEquals(emits, [
        [ 'a', 0 ],
        [ 'b', 0 ],
        [ 'a', 0 ],
        [ 'a', 0 ],
        [ 'a', 1 ],
        [ 'b', 1 ]
    ], 'b only emits when a changed')
    t.end()
})

// will come back to this later see https://github.com/JAForbes/S/issues/20
test.skip('query caching', t => {

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
            .filter( x => {
                store;
                let answer = (
                    x.organization_id == organization_id.read() 
                    && (schedule_id.read() == null || x.schedule_id == schedule_id.read())
                    && (project_id.read() == null || x.project_id == project_id.read())
                )

                return answer
            })
        

        type Project = ReturnType<typeof project.read>;
        let projectsRecorded : Project[] = []
        S.computation(() => {
            projectsRecorded.push( project.read() )
        })

        t.deepEquals(projectsRecorded, [
            { project_id: 1, schedule_id: 1, organization_id: 1 }
        ], '1st evaluation of computation')

        
        S.freeze(() => {
            project_id.write(() => 3)
            schedule_id.write(() => 3)
        })

        t.deepEquals(projectsRecorded, [
            { project_id: 1, schedule_id: 1, organization_id: 1 },
            { project_id: 3, schedule_id: 3, organization_id: 1 }
        ], '2 writes in a freeze triggered only 1 emit')

        projectsRecorded.length = 0

        schedule_id.write(() => 2)
        project_id.write(() => 2)
        organization_id.write(() => 2)

        t.deepEquals(projectsRecorded, [
            undefined,
            { project_id: 2, schedule_id: 2, organization_id: 2 }
        ], '3 writes, 3 emits')
        dispose()
    })

    t.end()
})

test('updatable views', t => {

    Store.root(() => {

        let counts = {
            store: 0,
            users: 0,
            projects: 0,
            project: 0,
            user: 0
        }
        let store = Store.createStore('@', [{
            users: [] as User[],
            projects: [] as Project[]
        }])

        let usersStore = store.prop('users')
        
        let projectsStore = store.prop('projects')

        let user_id = S.data(1)
        let project_id = S.data(2)

        usersStore.write( () => [{ id:1, name: 'James', tags: ['red'] }, { id:2, name: 'Emmanuel', tags: ['blue'] }, { id: 3, name: 'Jack', tags: ['red']}])
        projectsStore.write( () => [{ id:1, name: 'NSW456'}, { id:2, name: 'QLD123'}])

        let userStore = usersStore.unnest().filter(x => x.id === user_id() )
        let projectStore = projectsStore.unnest().filter( x => x.id === project_id() )

        const nameStore = userStore.prop("name")

        S.computation(() => {
            counts.store++
            store.read()
        })
        S.computation(() => {
            counts.users++
            usersStore.read()
        })
        S.computation(() => {
            counts.projects++
            projectsStore.read()
        })
        S.computation(() => {
            counts.project++
            projectStore.read()
        })
        S.computation(() => {
            counts.user++
            userStore.read()
        })

        console.log({counts})
        t.deepEquals(counts, { store: 1, users: 1, projects: 1, project: 1, user: 1 }, '1 emit for setup')
        nameStore.write(() => 'John')
        t.deepEquals(counts, { store: 2, users: 2, projects: 1, project: 1, user: 2 }, 'name changed = store,users,user update only')

        const redUsers = store.prop('users')
            .unnest()
            .filter( x => x.tags.includes('red') )

        t.deepEquals(counts, { store: 2, users: 2, projects: 1, project: 1, user: 2 }, 'Defining new query doesnt trigger propagation')
        
        redUsers.prop('name').write( x => x + '!')

        t.deepEquals(counts, { store: 3, users: 3, projects: 1, project: 1, user: 3 }, 'Writing to query updated expected upstream subscriptions')
        

        t.deepEquals(
            store.sample().users,
            [
                { id: 1, name: 'John!', tags: [ 'red' ] },
                { id: 2, name: 'Emmanuel', tags: [ 'blue' ] },
                { id: 3, name: 'Jack!', tags: [ 'red' ] }
            ]
            , 'Update multiple objects matching a predicate'
        )

    })
    t.end()
})