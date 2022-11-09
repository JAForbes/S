import * as Store from '../lib/store.js'
import * as S from '../lib/index.js'
import test from 'tape'
type User = { id: number, name: string, tags: string[] }
type Project = { id: number, name: string }

test('store', t => {

    Store.root(() => {

        let store = Store.createStore([{
            users: [] as User[],
            projects: [] as Project[]
        }])

        let usersStore = store.prop('users')
        
        let projectsStore = store.prop('projects')

        let user_id = S.data(1)
        let project_id = S.data(2)

        usersStore.setState( () => [{ id:1, name: 'James', tags: ['red'] }, { id:2, name: 'Emmanuel', tags: ['blue'] }, { id: 3, name: 'Jack', tags: ['red']}])
        projectsStore.setState( () => [{ id:1, name: 'NSW456'}, { id:2, name: 'QLD123'}])


        let userStore = usersStore.whereUnnested({ "id": user_id })

        let projectStore = projectsStore.whereUnnested({ "id": project_id })

        const nameStore = userStore.prop("name")

        S.computation(() => {
            console.log('store.read', store.read())
        })
        S.computation(() => {
            console.log('usersStore.read', usersStore.read())
        })
        S.computation(() => {
            console.log('projectsStore.read', projectsStore.read())
        })
        S.computation(() => {
            console.log('projectStore.read', projectStore.read())
        })
        S.computation(() => {
            console.log('userStore.read', userStore.read())
        })

        console.log('updating name store')
        nameStore.setState(() => 'John')

        const redUsers = store.prop('users')
            .unnest()
            .filter( x => x.tags.includes('red') )

        
        redUsers.prop('name').setState( x => x + '!')
        console.log(redUsers.sampleAll())
        console.log(store.sample().users)

    })
    t.end()
})