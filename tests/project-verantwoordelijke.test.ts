import assert from 'node:assert/strict'
import { projectVerantwoordelijke, PROJECT_VERANTWOORDELIJKEN } from '../lib/opdrachten-kanban'

assert.deepEqual([...PROJECT_VERANTWOORDELIJKEN], ['Marco', 'Bram', 'Gezamenlijke lead'])
assert.equal(projectVerantwoordelijke('Bram Reinquin'), 'Bram')
assert.equal(projectVerantwoordelijke('marco'), 'Marco')
assert.equal(projectVerantwoordelijke('Gezamenlijke lead'), 'Gezamenlijke lead')
assert.equal(projectVerantwoordelijke('samen'), 'Gezamenlijke lead')
assert.equal(projectVerantwoordelijke('Chiara'), null)
assert.equal(projectVerantwoordelijke(''), null)
assert.equal(projectVerantwoordelijke(null), null)
console.log('project-verantwoordelijke: ok')
