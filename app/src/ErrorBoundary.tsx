import { Component, type ReactNode } from 'react'

/**
 * If a screen ever breaks, show a calm page instead of a blank one.
 * Shop data lives in the phone's database, not in the screen, so nothing is lost.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    try { localStorage.setItem('pasal-last-error', JSON.stringify({ at: Date.now(), message: String(error.message).slice(0, 300), stack: String(error.stack ?? '').slice(0, 800) })) } catch { /* storage blocked */ }
  }

  render() {
    if (!this.state.error) return this.props.children
    const ne = (localStorage.getItem('pasal-lang') ?? 'ne') === 'ne'
    return (
      <div className="app" style={{ justifyContent: 'center', padding: 24, gap: 14, textAlign: 'center' }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <div className="hero">{ne ? 'केही गडबड भयो' : 'Something went wrong'}</div>
        <div className="mut">{ne ? 'तपाईंको डाटा फोनमा सुरक्षित छ। एप फेरि खोल्नुस्।' : 'Your data is safe on the phone. Please open the app again.'}</div>
        <button className="btn" onClick={() => location.reload()}>{ne ? 'फेरि खोल्नुस्' : 'Open again'}</button>
        <button className="btn o" onClick={() => this.setState({ error: null })}>{ne ? 'पछाडि जानुस्' : 'Go back'}</button>
        <small className="mut" style={{ wordBreak: 'break-word' }}>{this.state.error.message}</small>
      </div>
    )
  }
}
