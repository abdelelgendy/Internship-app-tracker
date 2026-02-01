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
  
useEffect(() => {
  setApplications([
    { id: 1, company: "Google", role: "Software Intern" },
    { id: 2, company: "Meta", role: "Frontend Intern" }
  ])
}, [])

function addApplication() {
  setApplications([
    ...applications,
    {
      id: Date.now(),
      company: "New Company",
      role: "New Role"
    }
  ])
}

  return (
    <div>
      <Header title='Internship tracker'/>

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
