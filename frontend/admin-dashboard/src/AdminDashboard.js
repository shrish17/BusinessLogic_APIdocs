import { useState, useEffect } from 'react';
import axios from 'axios';

const BACKEND_BASE = 'http://localhost:3001/api/admin';

export default function AdminDashboard() {
    const [activeTab, setActiveTab] = useState('config');
    
    // Section A: Rate Limit Config
    const [config, setConfig] = useState({
        maxRequests: '',
        windowSec: '',
        blockHours: '',
        cacheRefreshSec: ''
    });
    const [configMessage, setConfigMessage] = useState('');
    const [configError, setConfigError] = useState('');

    // Section B: Blocked IPs
    const [blockedIps, setBlockedIps] = useState([]);
    const [ipError, setIpError] = useState('');

    // Section C: Operation Blocking
    const [collections, setCollections] = useState([]);
    const [selectedCollection, setSelectedCollection] = useState('');
    const [operations, setOperations] = useState({
        create: true,
        read: true,
        update: true,
        delete: true
    });
    const [opMessage, setOpMessage] = useState('');
    const [opError, setOpError] = useState('');

    // Fetch initial data
    useEffect(() => {
        fetchConfig();
        fetchBlockedIps();
        fetchCollections();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchConfig = async () => {
        try {
            const res = await axios.get(`${BACKEND_BASE}/rate-limit-config`);
            const data = res.data;
            setConfig({
                maxRequests: data.maxRequests || '',
                windowSec: data.windowMs ? data.windowMs / 1000 : '',
                blockHours: data.blockDurationMs ? data.blockDurationMs / 3600000 : '',
                cacheRefreshSec: data.cacheRefreshMs ? data.cacheRefreshMs / 1000 : ''
            });
        } catch (err) {
            setConfigError(`Could not load configuration: ${err.response?.data?.error || err.message}`);
        }
    };

    const fetchBlockedIps = async () => {
        try {
            const res = await axios.get(`${BACKEND_BASE}/rate-limit-state`);
            setBlockedIps(res.data);
        } catch (err) {
            setIpError(`Could not load blocked IPs: ${err.response?.data?.error || err.message}`);
        }
    };

    const fetchCollections = async () => {
        try {
            const res = await axios.get(`${BACKEND_BASE}/collections`);
            setCollections(res.data);
            if (res.data.length > 0) {
                setSelectedCollection(res.data[0].name);
                fetchBlockedOperationsForCollection(res.data[0].name);
            }
        } catch (err) {
            setOpError(`Could not load collections: ${err.response?.data?.error || err.message}`);
        }
    };

    const fetchBlockedOperationsForCollection = async (colName) => {
        try {
            const res = await axios.get(`${BACKEND_BASE}/blocked-operations`);
            const config = res.data.find(c => c.collectionName === colName);
            if (config) {
                setOperations({
                    create: config.blockedOperations.includes('create'),
                    read: config.blockedOperations.includes('read'),
                    update: config.blockedOperations.includes('update'),
                    delete: config.blockedOperations.includes('delete')
                });
            } else {
                setOperations({ create: true, read: true, update: true, delete: true });
            }
        } catch (err) {
            setOpError(`Could not load operations for ${colName}: ${err.message}`);
        }
    };

    const handleCollectionChange = (e) => {
        const name = e.target.value;
        setSelectedCollection(name);
        fetchBlockedOperationsForCollection(name);
    };

    // Save Section A
    const handleConfigSubmit = async (e) => {
        e.preventDefault();
        setConfigMessage('');
        setConfigError('');

        const maxRequestsNum = Number(config.maxRequests);
        const windowMsNum = Number(config.windowSec) * 1000;
        const blockDurationMsNum = Number(config.blockHours) * 3600000;
        const cacheRefreshMsNum = Number(config.cacheRefreshSec) * 1000;

        if (isNaN(maxRequestsNum) || maxRequestsNum <= 0) {
            setConfigError('Could not save: requests must be a positive number');
            return;
        }
        if (isNaN(windowMsNum) || windowMsNum <= 0) {
            setConfigError('Could not save: time window must be a positive number');
            return;
        }
        if (isNaN(blockDurationMsNum) || blockDurationMsNum <= 0) {
            setConfigError('Could not save: block duration must be a positive number');
            return;
        }
        if (isNaN(cacheRefreshMsNum) || cacheRefreshMsNum <= 0) {
            setConfigError('Could not save: cache refresh interval must be a positive number');
            return;
        }

        try {
            const res = await axios.put(`${BACKEND_BASE}/rate-limit-config`, {
                maxRequests: maxRequestsNum,
                windowMs: windowMsMsNumHelper(windowMsNum),
                blockDurationMs: blockDurationMsNum,
                cacheRefreshMs: cacheRefreshMsNum
            });
            setConfig({
                maxRequests: res.data.maxRequests,
                windowSec: res.data.windowMs / 1000,
                blockHours: res.data.blockDurationMs / 3600000,
                cacheRefreshSec: res.data.cacheRefreshMs / 1000
            });
            setConfigMessage('Save changes succeeded');
        } catch (err) {
            setConfigError(`Could not save: ${err.response?.data?.error || err.message}`);
        }
    };

    const windowMsMsNumHelper = (ms) => ms;

    // Unblock IP (Section B)
    const handleUnblock = async (ip) => {
        setIpError('');
        try {
            await axios.delete(`${BACKEND_BASE}/rate-limit-state/${encodeURIComponent(ip)}`);
            fetchBlockedIps();
        } catch (err) {
            setIpError(`Could not unblock IP: ${err.response?.data?.error || err.message}`);
        }
    };

    // Save Section C
    const handleOpsSubmit = async (e) => {
        e.preventDefault();
        setOpMessage('');
        setOpError('');

        if (!selectedCollection) {
            setOpError('Could not save: collection name is required');
            return;
        }

        const blockedOps = [];
        if (operations.create) blockedOps.push('create');
        if (operations.read) blockedOps.push('read');
        if (operations.update) blockedOps.push('update');
        if (operations.delete) blockedOps.push('delete');

        try {
            await axios.put(`${BACKEND_BASE}/blocked-operations`, {
                collectionName: selectedCollection,
                blockedOperations: blockedOps
            });
            setOpMessage('Block updated successfully');
        } catch (err) {
            setOpError(`Could not save: ${err.response?.data?.error || err.message}`);
        }
    };

    const formatExpiry = (expiryStr) => {
        if (!expiryStr) return 'N/A';
        const date = new Date(expiryStr);
        return date.toLocaleString();
    };

    return (
        <div style={{
            fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace',
            backgroundColor: '#0d1117',
            color: '#c9d1d9',
            minHeight: '100vh',
            display: 'flex'
        }}>
            {/* Sidebar Navigation */}
            <div style={{
                width: '260px',
                borderRight: '1px solid #30363d',
                padding: '30px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '15px'
            }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#58a6ff', marginBottom: '20px' }}>
                    Admin Controls
                </div>
                <button 
                    onClick={() => setActiveTab('config')}
                    style={{
                        textAlign: 'left',
                        padding: '10px 15px',
                        background: activeTab === 'config' ? '#1f6feb' : 'transparent',
                        color: activeTab === 'config' ? '#ffffff' : '#c9d1d9',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '600'
                    }}>
                    Rate Limit Config
                </button>
                <button 
                    onClick={() => setActiveTab('ips')}
                    style={{
                        textAlign: 'left',
                        padding: '10px 15px',
                        background: activeTab === 'ips' ? '#1f6feb' : 'transparent',
                        color: activeTab === 'ips' ? '#ffffff' : '#c9d1d9',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '600'
                    }}>
                    Currently Blocked IPs
                </button>
                <button 
                    onClick={() => setActiveTab('operations')}
                    style={{
                        textAlign: 'left',
                        padding: '10px 15px',
                        background: activeTab === 'operations' ? '#1f6feb' : 'transparent',
                        color: activeTab === 'operations' ? '#ffffff' : '#c9d1d9',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '600'
                    }}>
                    Operation Blocking
                </button>
                <div style={{ marginTop: 'auto' }}>
                    <a href="http://localhost:3005" style={{ color: '#58a6ff', textDecoration: 'none', fontSize: '14px' }}>
                        &larr; Back to API Docs
                    </a>
                </div>
            </div>

            {/* Main Content Area */}
            <div style={{ flex: 1, padding: '40px 50px', overflowY: 'auto' }}>
                {activeTab === 'config' && (
                    <div>
                        <h2 style={{ color: '#f0f6fc', borderBottom: '1px solid #21262d', paddingBottom: '10px' }}>
                            Rate Limit Config
                        </h2>
                        <p style={{ color: '#8b949e', fontSize: '14px', marginBottom: '30px' }}>
                            Configure the global limits enforced on clients before blocking operations.
                        </p>

                        {configError && (
                            <div style={{ padding: '15px', backgroundColor: '#f851491a', border: '1px solid #f85149', borderRadius: '6px', color: '#f85149', marginBottom: '20px' }}>
                                {configError}
                            </div>
                        )}
                        {configMessage && (
                            <div style={{ padding: '15px', backgroundColor: '#2ea44f15', border: '1px solid #3fb950', borderRadius: '6px', color: '#3fb950', marginBottom: '20px' }}>
                                {configMessage}
                            </div>
                        )}

                        <form onSubmit={handleConfigSubmit} style={{ maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div>
                                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#c9d1d9' }}>
                                    Requests Allowed
                                </label>
                                <input 
                                    type="number"
                                    value={config.maxRequests}
                                    onChange={(e) => setConfig({ ...config, maxRequests: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        backgroundColor: '#0d1117',
                                        border: '1px solid #30363d',
                                        borderRadius: '6px',
                                        color: '#c9d1d9',
                                        fontSize: '14px'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#c9d1d9' }}>
                                    Time Window (seconds)
                                </label>
                                <input 
                                    type="number"
                                    value={config.windowSec}
                                    onChange={(e) => setConfig({ ...config, windowSec: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        backgroundColor: '#0d1117',
                                        border: '1px solid #30363d',
                                        borderRadius: '6px',
                                        color: '#c9d1d9',
                                        fontSize: '14px'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#c9d1d9' }}>
                                    Block Duration (hours)
                                </label>
                                <input 
                                    type="number"
                                    value={config.blockHours}
                                    onChange={(e) => setConfig({ ...config, blockHours: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        backgroundColor: '#0d1117',
                                        border: '1px solid #30363d',
                                        borderRadius: '6px',
                                        color: '#c9d1d9',
                                        fontSize: '14px'
                                    }}
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#c9d1d9' }}>
                                    Cache Refresh Interval (seconds)
                                </label>
                                <input 
                                    type="number"
                                    value={config.cacheRefreshSec}
                                    onChange={(e) => setConfig({ ...config, cacheRefreshSec: e.target.value })}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        backgroundColor: '#0d1117',
                                        border: '1px solid #30363d',
                                        borderRadius: '6px',
                                        color: '#c9d1d9',
                                        fontSize: '14px'
                                    }}
                                />
                            </div>

                            <button 
                                type="submit"
                                style={{
                                    padding: '12px 20px',
                                    backgroundColor: '#238636',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    marginTop: '10px',
                                    alignSelf: 'flex-start'
                                }}>
                                Save changes
                            </button>
                        </form>
                    </div>
                )}

                {activeTab === 'ips' && (
                    <div>
                        <h2 style={{ color: '#f0f6fc', borderBottom: '1px solid #21262d', paddingBottom: '10px' }}>
                            Currently Blocked IPs
                        </h2>
                        <p style={{ color: '#8b949e', fontSize: '14px', marginBottom: '30px' }}>
                            Inspect the rate-limiting state of active clients and clear manual blocks.
                        </p>

                        {ipError && (
                            <div style={{ padding: '15px', backgroundColor: '#f851491a', border: '1px solid #f85149', borderRadius: '6px', color: '#f85149', marginBottom: '20px' }}>
                                {ipError}
                            </div>
                        )}

                        <table style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '14px',
                            textAlign: 'left'
                        }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #30363d' }}>
                                    <th style={{ padding: '12px 8px', color: '#8b949e' }}>IP Address</th>
                                    <th style={{ padding: '12px 8px', color: '#8b949e' }}>Status</th>
                                    <th style={{ padding: '12px 8px', color: '#8b949e' }}>Requests in Window</th>
                                    <th style={{ padding: '12px 8px', color: '#8b949e' }}>Violations</th>
                                    <th style={{ padding: '12px 8px', color: '#8b949e' }}>Block Expiry</th>
                                    <th style={{ padding: '12px 8px', color: '#8b949e', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {blockedIps.length === 0 ? (
                                    <tr>
                                        <td colSpan="6" style={{ padding: '30px 8px', textAlign: 'center', color: '#8b949e' }}>
                                            No clients are currently blocked or recorded in database.
                                        </td>
                                    </tr>
                                ) : (
                                    blockedIps.map((client) => (
                                        <tr key={client.ip} style={{ borderBottom: '1px solid #21262d' }}>
                                            <td style={{ padding: '12px 8px', fontWeight: 'bold' }}>{client.ip}</td>
                                            <td style={{ padding: '12px 8px' }}>
                                                {client.blocked ? (
                                                    <span style={{ color: '#f85149', backgroundColor: '#f851491a', padding: '3px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                                                        Blocked
                                                    </span>
                                                ) : (
                                                    <span style={{ color: '#3fb950', backgroundColor: '#2ea44f15', padding: '3px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                                                        Active
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '12px 8px' }}>{client.requests}</td>
                                            <td style={{ padding: '12px 8px' }}>{client.violationCount}</td>
                                            <td style={{ padding: '12px 8px' }}>{formatExpiry(client.blockExpiry)}</td>
                                            <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                                                <button 
                                                    onClick={() => handleUnblock(client.ip)}
                                                    style={{
                                                        padding: '6px 12px',
                                                        backgroundColor: '#21262d',
                                                        color: '#c9d1d9',
                                                        border: '1px solid #30363d',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        fontSize: '12px',
                                                        fontWeight: 'bold'
                                                    }}>
                                                    Unblock
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {activeTab === 'operations' && (
                    <div>
                        <h2 style={{ color: '#f0f6fc', borderBottom: '1px solid #21262d', paddingBottom: '10px' }}>
                            Operation Blocking by Table
                        </h2>
                        <p style={{ color: '#8b949e', fontSize: '14px', marginBottom: '30px' }}>
                            Configure which CRUD operations are denied when a client IP is blocked.
                        </p>

                        <div style={{
                            padding: '15px',
                            backgroundColor: '#2ea44f15',
                            border: '1px solid #3fb950',
                            borderRadius: '6px',
                            color: '#3fb950',
                            fontSize: '14px',
                            marginBottom: '35px'
                        }}>
                            <strong>Enforcement Status: Active</strong>
                            <p style={{ margin: '5px 0 0 0', color: '#c9d1d9' }}>
                                Changes here take effect immediately on live traffic.
                            </p>
                        </div>

                        {opError && (
                            <div style={{ padding: '15px', backgroundColor: '#f851491a', border: '1px solid #f85149', borderRadius: '6px', color: '#f85149', marginBottom: '20px' }}>
                                {opError}
                            </div>
                        )}
                        {opMessage && (
                            <div style={{ padding: '15px', backgroundColor: '#2ea44f15', border: '1px solid #3fb950', borderRadius: '6px', color: '#3fb950', marginBottom: '20px' }}>
                                {opMessage}
                            </div>
                        )}

                        <form onSubmit={handleOpsSubmit} style={{ maxWidth: '500px', display: 'flex', flexDirection: 'column', gap: '25px' }}>
                            <div>
                                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '8px', color: '#c9d1d9' }}>
                                    Select Collection
                                </label>
                                <select 
                                    value={selectedCollection}
                                    onChange={handleCollectionChange}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        backgroundColor: '#0d1117',
                                        border: '1px solid #30363d',
                                        borderRadius: '6px',
                                        color: '#c9d1d9',
                                        fontSize: '14px'
                                    }}>
                                    {collections.length === 0 && <option value="">No collections found</option>}
                                    {collections.map(c => (
                                        <option key={c.name} value={c.name}>{c.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '12px', color: '#c9d1d9' }}>
                                    Blocked Operations
                                </label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                        <input 
                                            type="checkbox"
                                            checked={operations.create}
                                            onChange={(e) => setOperations({ ...operations, create: e.target.checked })}
                                            style={{ cursor: 'pointer' }}
                                        />
                                        <span>Create (POST)</span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                        <input 
                                            type="checkbox"
                                            checked={operations.read}
                                            onChange={(e) => setOperations({ ...operations, read: e.target.checked })}
                                            style={{ cursor: 'pointer' }}
                                        />
                                        <span>Read (GET)</span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                        <input 
                                            type="checkbox"
                                            checked={operations.update}
                                            onChange={(e) => setOperations({ ...operations, update: e.target.checked })}
                                            style={{ cursor: 'pointer' }}
                                        />
                                        <span>Update (PUT)</span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                        <input 
                                            type="checkbox"
                                            checked={operations.delete}
                                            onChange={(e) => setOperations({ ...operations, delete: e.target.checked })}
                                            style={{ cursor: 'pointer' }}
                                        />
                                        <span>Delete (DELETE)</span>
                                    </label>
                                </div>
                            </div>

                            <button 
                                type="submit"
                                style={{
                                    padding: '12px 20px',
                                    backgroundColor: '#238636',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    alignSelf: 'flex-start'
                                }}>
                                Block updated
                            </button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}
