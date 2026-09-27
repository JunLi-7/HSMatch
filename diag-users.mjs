import db from './server/db.js'

const users = db
  .prepare('SELECT id,username,full_name,role,created_at FROM users ORDER BY id DESC')
  .all()
console.log('总用户数:', users.length)
for (const u of users) {
  const reg = db.prepare('SELECT COUNT(*) c FROM registrations WHERE user_id=?').get(u.id).c
  const tourns = db
    .prepare(
      'SELECT t.name FROM registrations r JOIN tournaments t ON t.id=r.tournament_id WHERE r.user_id=?'
    )
    .all(u.id)
    .map((x) => x.name)
  console.log(
    `id=${u.id}\t${u.username}\t角色=${u.role}\t报名赛事数=${reg}${tourns.length ? ' [' + tourns.join(',') + ']' : ''}`
  )
}
