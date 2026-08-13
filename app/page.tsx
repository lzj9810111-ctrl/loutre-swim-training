'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase/client'

type Role = 'coach' | 'parent' | 'admin'
type Student = { id: string; name: string; birthday?: string | null; gender?: string | null }
type RecordRow = { id: string; student_id: string; trained_on: string; stroke: string; distance_m: number; result_seconds: number; note?: string | null }
type Screen = 'auth' | 'home' | 'students' | 'record' | 'parent'

const strokes = [
  ['freestyle', '自由泳'],
  ['breaststroke', '蛙泳'],
  ['backstroke', '仰泳'],
  ['butterfly', '蝶泳'],
  ['medley', '混合泳'],
  ['kick', '打腿'],
  ['other', '其他'],
] as const

const distances = [25, 50, 100, 200, 400]

export default function App() {
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [name, setName] = useState('')
  const [screen, setScreen] = useState<Screen>('auth')
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [message, setMessage] = useState('')
  const [students, setStudents] = useState<Student[]>([])
  const [records, setRecords] = useState<RecordRow[]>([])
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null)
  const [step, setStep] = useState(1)
  const [stroke, setStroke] = useState('')
  const [distance, setDistance] = useState<number | null>(null)
  const [time, setTime] = useState('')
  const [inviteCode, setInviteCode] = useState('')

  useEffect(() => {
    let alive = true

    async function boot() {
      const { data } = await supabase.auth.getSession()
      if (!alive) return
      if (!data.session?.user) {
        setLoading(false)
        return
      }
      await loadProfile(data.session.user.id)
    }

    boot()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        setUserId(null)
        setRole(null)
        setName('')
        setStudents([])
        setRecords([])
        setScreen('auth')
        setLoading(false)
      } else {
        await loadProfile(session.user.id)
      }
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  async function loadProfile(uid: string) {
    setLoading(true)
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('display_name, role')
      .eq('id', uid)
      .single()

    if (error || !profile) {
      setMessage('账号资料读取失败，请重新登录。')
      setLoading(false)
      return
    }

    setUserId(uid)
    setRole(profile.role as Role)
    setName(profile.display_name || '')

    if (profile.role === 'parent') {
      setScreen('parent')
      await loadParentData()
    } else {
      setScreen('home')
      await loadCoachData(uid)
    }

    setLoading(false)
  }

  async function loadCoachData(uid = userId) {
    if (!uid) return false

    const [studentResult, recordResult] = await Promise.all([
      supabase
        .from('students')
        .select('id,name,birthday,gender')
        .eq('coach_id', uid)
        .order('created_at', { ascending: false }),
      supabase
        .from('training_records')
        .select('id,student_id,trained_on,stroke,distance_m,result_seconds,note')
        .eq('coach_id', uid)
        .order('created_at', { ascending: false }),
    ])

    if (studentResult.error) {
      setMessage(`学员读取失败：${studentResult.error.message}`)
      return false
    }

    setStudents((studentResult.data || []) as Student[])

    if (recordResult.error) {
      setMessage(`训练记录读取失败：${recordResult.error.message}`)
      return false
    }

    setRecords((recordResult.data || []) as RecordRow[])
    return true
  }

  async function loadParentData() {
    const { data: links, error: linkError } = await supabase
      .from('parent_students')
      .select('student_id, students(id,name,birthday,gender)')

    if (linkError) {
      setMessage(`学员读取失败：${linkError.message}`)
      return
    }

    const childList: Student[] = []
    for (const link of (links || []) as any[]) {
      const s = Array.isArray(link.students) ? link.students[0] : link.students
      if (s) childList.push(s)
    }

    setStudents(childList)
    const ids = childList.map((s) => s.id)

    if (!ids.length) {
      setRecords([])
      return
    }

    const { data: r, error: recordError } = await supabase
      .from('training_records')
      .select('id,student_id,trained_on,stroke,distance_m,result_seconds,note')
      .in('student_id', ids)
      .order('created_at', { ascending: false })

    if (recordError) {
      setMessage(`训练记录读取失败：${recordError.message}`)
      return
    }

    setRecords((r || []) as RecordRow[])
  }

  async function handleAuth(formData: FormData) {
    setMessage('')
    const email = String(formData.get('email') || '').trim()
    const password = String(formData.get('password') || '')

    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMessage('邮箱或密码不正确。')
      return
    }

    const displayName = String(formData.get('display_name') || '').trim()
    const requestedRole = formData.get('role') === 'parent' ? 'parent' : 'coach'
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName, requested_role: requestedRole } },
    })

    if (error) setMessage(error.message)
    else if (!data.session) setMessage('账号已创建，请先在邮箱完成验证后登录。')
  }

  async function addStudent(formData: FormData) {
    if (!userId) return

    const studentName = String(formData.get('name') || '').trim()
    if (!studentName) return

    const { data: newStudent, error } = await supabase
      .from('students')
      .insert({ coach_id: userId, name: studentName })
      .select('id,name,birthday,gender')
      .single()

    if (error || !newStudent) {
      setMessage(error?.message || '学员添加失败')
      return
    }

    setStudents((current) => [
      newStudent as Student,
      ...current.filter((student) => student.id !== newStudent.id),
    ])
    setMessage('学员已添加')
    await loadCoachData(userId)
  }

  async function beginRecord(student?: Student) {
    setSelectedStudent(student || null)
    setStroke('')
    setDistance(null)
    setTime('')
    setStep(student ? 2 : 1)
    setMessage('')

    if (!student && userId) {
      await loadCoachData(userId)
    }

    setScreen('record')
  }

  async function openStudents() {
    if (userId) await loadCoachData(userId)
    setScreen('students')
  }

  async function saveRecord() {
    if (!userId || !selectedStudent || !stroke || !distance || !time) return

    const seconds = parseTime(time)
    if (!seconds || seconds <= 0) {
      setMessage('请输入有效成绩')
      return
    }

    const { error } = await supabase.from('training_records').insert({
      student_id: selectedStudent.id,
      coach_id: userId,
      trained_on: new Date().toISOString().slice(0, 10),
      stroke,
      distance_m: distance,
      result_seconds: seconds,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage(`${selectedStudent.name} 的成绩已保存`)
    await loadCoachData(userId)
    setScreen('home')
  }

  async function makeInvite(student: Student) {
    const { data, error } = await supabase.rpc('create_parent_invite', {
      p_student_id: student.id,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    const row = Array.isArray(data) ? data[0] : data
    setInviteCode(row?.code || '')
    setSelectedStudent(student)
  }

  async function redeemInvite(formData: FormData) {
    const code = String(formData.get('code') || '').trim()
    if (!code) return

    const { error } = await supabase.rpc('redeem_parent_invite', { p_code: code })
    if (error) setMessage('邀请码无效或已过期。')
    else {
      setMessage('绑定成功')
      await loadParentData()
    }
  }

  const selectedRecords = useMemo(
    () => (selectedStudent ? records.filter((r) => r.student_id === selectedStudent.id) : []),
    [records, selectedStudent],
  )

  if (loading) {
    return (
      <main className="shell center">
        <div className="eyebrow">LOUTRE TRAINING</div>
        <h1>正在加载…</h1>
      </main>
    )
  }

  if (screen === 'auth' || !userId) {
    return (
      <main className="shell auth-shell">
        <section className="auth-card">
          <div className="eyebrow">LOUTRE TRAINING</div>
          <h1>{authMode === 'login' ? '登录' : '创建账号'}</h1>
          <p className="muted">教练负责记录，家长仅查看自己孩子的数据。</p>
          {message && <div className="notice">{message}</div>}
          <form action={handleAuth} className="form-stack">
            {authMode === 'register' && (
              <>
                <label>
                  姓名
                  <input name="display_name" required />
                </label>
                <label>
                  身份
                  <select name="role" defaultValue="coach">
                    <option value="coach">教练</option>
                    <option value="parent">家长</option>
                  </select>
                </label>
              </>
            )}
            <label>
              邮箱
              <input name="email" type="email" required />
            </label>
            <label>
              密码
              <input name="password" type="password" minLength={6} required />
            </label>
            <button className="button primary-button" type="submit">
              {authMode === 'login' ? '登录' : '创建账号'}
            </button>
          </form>
          <button
            className="text-button"
            onClick={() => {
              setAuthMode(authMode === 'login' ? 'register' : 'login')
              setMessage('')
            }}
          >
            {authMode === 'login' ? '没有账号？创建账号' : '已有账号？返回登录'}
          </button>
        </section>
      </main>
    )
  }

  if (role === 'parent' || screen === 'parent') {
    return (
      <main className="shell">
        <Header name={name} onHome={() => setScreen('parent')} />
        {message && <div className="notice">{message}</div>}
        <section className="card">
          <div className="eyebrow">绑定孩子</div>
          <h2>输入教练提供的邀请码</h2>
          <form action={redeemInvite} className="inline-form">
            <input name="code" placeholder="例如 A1B2C3D4E5F6" />
            <button className="button">绑定</button>
          </form>
        </section>
        {students.map((student) => {
          const rs = records.filter((r) => r.student_id === student.id)
          return (
            <section className="card" key={student.id}>
              <div className="eyebrow">家长端 · 只读</div>
              <h1>{student.name}</h1>
              <div className="history">
                {rs.length ? (
                  rs.map((r) => <RecordItem key={r.id} r={r} />)
                ) : (
                  <div className="empty">暂时没有训练记录</div>
                )}
              </div>
            </section>
          )
        })}
        {!students.length && <div className="empty">尚未绑定学员。</div>}
      </main>
    )
  }

  if (screen === 'home') {
    return (
      <main className="shell">
        <Header name={name} onHome={() => setScreen('home')} />
        {message && <div className="notice">{message}</div>}
        <div className="home-actions">
          <button className="hero-button" onClick={() => beginRecord()}>
            <span>＋</span>
            <b>开始记录</b>
            <small>快速录入今日训练成绩</small>
          </button>
          <button className="hero-button secondary" onClick={openStudents}>
            <span>◎</span>
            <b>查看学员</b>
            <small>资料、历史成绩与家长绑定</small>
          </button>
        </div>
      </main>
    )
  }

  if (screen === 'students') {
    return (
      <main className="shell">
        <Header name={name} onHome={() => setScreen('home')} />
        {message && <div className="notice">{message}</div>}
        <section className="card">
          <div className="eyebrow">添加学员</div>
          <form action={addStudent} className="inline-form">
            <input name="name" placeholder="输入学员姓名" required />
            <button className="button">添加</button>
          </form>
        </section>
        <div className="student-list">
          {students.map((s) => (
            <article className="student-row" key={s.id}>
              <button
                className="student-main"
                onClick={() => {
                  setSelectedStudent(s)
                  setScreen('students')
                }}
              >
                <b>{s.name}</b>
                <small>{records.filter((r) => r.student_id === s.id).length} 条训练记录</small>
              </button>
              <button onClick={() => beginRecord(s)}>记录</button>
              <button onClick={() => makeInvite(s)}>家长码</button>
            </article>
          ))}
        </div>
        {!students.length && <div className="empty">还没有学员，请先添加学员。</div>}
        {inviteCode && selectedStudent && (
          <section className="card invite-card">
            <div className="eyebrow">{selectedStudent.name} · 家长邀请码</div>
            <div className="invite-code">{inviteCode}</div>
            <p className="muted">一次性使用，7 天有效。家长绑定后只有查看权限。</p>
          </section>
        )}
        {selectedStudent && (
          <section className="card">
            <div className="eyebrow">近期记录</div>
            <h2>{selectedStudent.name}</h2>
            <div className="history">
              {selectedRecords.length ? (
                selectedRecords.slice(0, 20).map((r) => <RecordItem key={r.id} r={r} />)
              ) : (
                <div className="empty">还没有训练记录</div>
              )}
            </div>
          </section>
        )}
      </main>
    )
  }

  return (
    <main className="shell">
      <Header name={name} onHome={() => setScreen('home')} />
      {message && <div className="notice">{message}</div>}
      <div className="step-head">
        <button className="text-button" onClick={() => (step === 1 ? setScreen('home') : setStep(step - 1))}>
          ← 返回
        </button>
        <span>{step}/4</span>
      </div>

      {step === 1 && (
        <>
          <div className="eyebrow">第一步</div>
          <h1>选择学员</h1>
          <div className="student-grid">
            {students.map((s) => (
              <button
                className="choice"
                key={s.id}
                onClick={() => {
                  setSelectedStudent(s)
                  setStep(2)
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
          {!students.length && <div className="empty">还没有学员，请先返回并添加学员。</div>}
        </>
      )}

      {step === 2 && (
        <>
          <div className="eyebrow">{selectedStudent?.name}</div>
          <h1>训练项目</h1>
          <div className="choice-grid">
            {strokes.map(([key, label]) => (
              <button
                className="choice"
                key={key}
                onClick={() => {
                  setStroke(key)
                  setStep(3)
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="eyebrow">
            {selectedStudent?.name} · {strokeLabel(stroke)}
          </div>
          <h1>训练距离</h1>
          <div className="choice-grid">
            {distances.map((d) => (
              <button
                className="choice distance"
                key={d}
                onClick={() => {
                  setDistance(d)
                  setStep(4)
                }}
              >
                {d}
                <small>m</small>
              </button>
            ))}
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <div className="eyebrow">
            {selectedStudent?.name} · {distance}m {strokeLabel(stroke)}
          </div>
          <h1>输入成绩</h1>
          <div className="time-display">{time || '00.00'}</div>
          <div className="keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', ':', '0', '.'].map((k) => (
              <button key={k} onClick={() => setTime(time + k)}>
                {k}
              </button>
            ))}
            <button className="delete-key" onClick={() => setTime(time.slice(0, -1))}>
              ← 删除
            </button>
          </div>
          <button className="button save-button" onClick={saveRecord}>
            保存记录
          </button>
        </>
      )}
    </main>
  )
}

function Header({ name, onHome }: { name: string; onHome: () => void }) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onHome}>
        <span className="eyebrow">LOUTRE TRAINING</span>
        <b>{name || '用户'}</b>
      </button>
      <button className="logout" onClick={() => supabase.auth.signOut()}>
        退出
      </button>
    </header>
  )
}

function RecordItem({ r }: { r: RecordRow }) {
  return (
    <div className="record-row">
      <div>
        <small>{r.trained_on}</small>
        <b>
          {r.distance_m}m {strokeLabel(r.stroke)}
        </b>
      </div>
      <strong>{formatTime(Number(r.result_seconds))}</strong>
    </div>
  )
}

function strokeLabel(key: string) {
  return Object.fromEntries(strokes)[key] || key
}

function parseTime(value: string) {
  const clean = value.trim()
  if (clean.includes(':')) {
    const [m, s] = clean.split(':')
    const total = Number(m) * 60 + Number(s)
    return Number.isFinite(total) ? total : 0
  }
  const n = Number(clean)
  return Number.isFinite(n) ? n : 0
}

function formatTime(seconds: number) {
  if (seconds < 60) return seconds.toFixed(2)
  const m = Math.floor(seconds / 60)
  return `${m}:${(seconds - m * 60).toFixed(2).padStart(5, '0')}`
}
