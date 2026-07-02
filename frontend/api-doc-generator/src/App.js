import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'
import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import './App.css'

function App() {
    const [spec,   setSpec]   = useState(null)
    const [status, setStatus] = useState("Connecting...")
    const wsRef = useRef(null)

    useEffect(() => {
        function connect() {
            const ws = new WebSocket('ws://localhost:3001')
            wsRef.current = ws

            ws.onopen = () => {
                console.log('WebSocket connected')
                setStatus("Connected — waiting for docs...")
            }

            ws.onmessage = async (event) => {
                const msg = JSON.parse(event.data)
                if (msg.type === 'spec_updated') {
                    try {
                        const res = await axios.get('http://localhost:3001/api/openapi')
                        setSpec(JSON.parse(res.data.openapi))
                        setStatus("Live")
                    } catch (err) {
                        console.error('Failed to fetch spec:', err)
                        setStatus("Error fetching spec")
                    }
                }
            }

            ws.onclose = () => {
                console.log('WebSocket disconnected — reconnecting in 3s...')
                setStatus("Reconnecting...")
                setTimeout(connect, 3000)
            }

            ws.onerror = (err) => {
                console.error('WebSocket error:', err)
                ws.close()
            }
        }

        connect()

        return () => {
            if (wsRef.current) wsRef.current.close()
        }
    }, [])

    const isDotActive = status === "Live" || status.startsWith("Connected");

    return (
        <div className="app-container">
            <header className="custom-header">
                <h1 className="header-title">API Documentation Generator</h1>
                <div className="status-badge">
                    <span className={`status-dot ${isDotActive ? 'status-dot-active' : ''}`}></span>
                    <span className="status-text">{status}</span>
                </div>
            </header>
            <hr className="header-divider" />
            <div className="swagger-wrapper">
                { spec ? <SwaggerUI spec={spec} /> : <p className="loading-text">Loading docs...</p> }
            </div>
        </div>
    )
}

export default App