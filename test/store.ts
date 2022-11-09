import * as Store from '../lib/store.js'
import * as S from '../lib/index.js'
import test from 'tape'
type User = { id: number, name: string }
type Project = { id: number, name: string }

test('store', t => {

    Store.root(() => {

        let store = Store.createStore([{
            users: [] as User[],
            projects: [] as Project[]
        }])

        let usersStore = store.focus( x => [x.users], (state, update) => ({ ...state, users: update(state.users) }))
        let projectsStore = store.focus( x => [x.projects], (state, update) => ({ ...state, projects: update(state.projects) }))

        let user_id = S.data(1)
        let project_id = S.data(2)


        usersStore.setState( () => [{ id:1, name: 'James'}, { id:2, name: 'Emmanuel'}])
        projectsStore.setState( () => [{ id:1, name: 'NSW456'}, { id:2, name: 'QLD123'}])

        let userStore = usersStore.focus( xs => xs.filter( x => x.id == user_id() ), (users, update) => users.map( x => x.id === user_id() ? update(x) : x) )
        let projectStore = projectsStore.focus( xs => xs.filter( x => x.id == project_id() ), (projects, update) => projects.map( x => x.id === project_id() ? update(x) : x) )


        const nameStore = userStore.focus( x => [x.name], (user, update) => ({ ...user, name: update(user.name) }))

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

    })
    t.end()
})