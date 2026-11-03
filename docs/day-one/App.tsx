import { useEffect, useState } from 'react'
import './App.css'
import Header from './Components/Header'

interface Application {
  id: number
  company: string
  role: string
}



function App() {
  const [applications, setApplications] = useState<Application[]>([])
  const [companyInput, setCompanyInput] = useState("")
  const [roleInput, setRoleInput] = useState("")


useEffect(() => {
  setApplications([
    { id: 1, company: "Google", role: "Software Intern" },
    { id: 2, company: "Meta", role: "Frontend Intern" }
  ])
}, [])

  
  function addApplication() {
  if (!companyInput.trim() || !roleInput.trim()) return

  setApplications([
    ...applications,
    {
      id: Date.now(),
      company: companyInput.trim(),
      role: roleInput.trim()
    }
  ])

  setCompanyInput("")
  setRoleInput("")
 }


  return (
    <div>
      <Header title='Internship tracker'/>
      <input 
      value={companyInput}
      onChange={(e)=> setCompanyInput(e.target.value)}
      placeholder='Company'
      />
      <input value={roleInput}
      onChange={(e)=> setRoleInput(e.target.value)}
      placeholder='Role'
      />
      
      <button onClick={addApplication}>
        Add Application 
      </button>

      <ul>
        {applications.map(app => (
          <li key={app.id}>
            {app.company} - {app.role}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default App
