/* src/components/CustomFunctionEditor.js */

import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';

const CustomFunctionEditor = ({ mode, existingData, onClose, onSaved }) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [code, setCode] = useState('');
    const [templates, setTemplates] = useState({});
    const [activeTab, setActiveTab] = useState('custom'); // 'custom' or template key
    const [error, setError] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    // Track if code has been manually modified since template selection
    const [isDirty, setIsDirty] = useState(false);

    // Fetch templates
    useEffect(() => {
        const fetchTemplates = async () => {
            try {
                const res = await axios.get('http://localhost:3001/api/custom-functions/templates');
                setTemplates(res.data);
            } catch (err) {
                console.error('Failed to fetch templates:', err);
            }
        };
        fetchTemplates();
    }, []);

    // Set initial values if in edit mode
    useEffect(() => {
        if (mode === 'edit' && existingData) {
            setName(existingData.functionName || '');
            setDescription(existingData.description || '');
            setCode(existingData.code || '');
            setActiveTab('custom');
            setIsDirty(false);
        } else {
            setName('');
            setDescription('');
            setCode('// Write your custom function code here\nreturn { message: "Hello World" };');
            setActiveTab('custom');
            setIsDirty(false);
        }
    }, [mode, existingData]);

    const handleTemplateClick = (key) => {
        if (key === 'custom') {
            setActiveTab('custom');
            return;
        }

        const template = templates[key];
        if (!template) return;

        // If code has been modified, ask for confirmation
        if (isDirty && code.trim() !== '' && code.trim() !== template.code.trim()) {
            const confirmOverwrite = window.confirm("This will replace your current code in the editor. Continue?");
            if (!confirmOverwrite) return;
        }

        setCode(template.code);
        setActiveTab(key);
        setIsDirty(false);
    };

    const handleCodeChange = (value) => {
        setCode(value || '');
        setIsDirty(true);
    };

    const handleSaveClick = () => {
        if (!name.trim()) {
            setError('Function Name is required.');
            return;
        }
        if (!code.trim()) {
            setError('Function Code is required.');
            return;
        }

        setError('');

        if (mode === 'edit') {
            setShowConfirm(true);
        } else {
            submitSave();
        }
    };

    const submitSave = async () => {
        setIsSaving(true);
        setError('');
        try {
            if (mode === 'create') {
                await axios.post('http://localhost:3001/api/custom-functions', {
                    functionName: name.trim(),
                    description: description.trim(),
                    code,
                    template: activeTab !== 'custom' ? activeTab : null
                });
            } else {
                await axios.put(`http://localhost:3001/api/custom-functions/${name}`, {
                    description: description.trim(),
                    code
                });
            }
            setShowConfirm(false);
            if (onSaved) onSaved();
        } catch (err) {
            console.error('Error saving custom function:', err);
            const errMsg = err.response?.data?.error || err.message || 'Failed to save custom function.';
            setError(errMsg);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="modal-overlay" style={styles.overlay}>
            <div className="modal-content" style={styles.modal}>
                <div style={styles.header}>
                    <h2 style={styles.title}>{mode === 'create' ? 'Create Custom Function' : 'Edit Custom Function'}</h2>
                    <button onClick={onClose} style={styles.closeBtn}>&times;</button>
                </div>

                {error && <div style={styles.errorAlert}>{error}</div>}

                <div style={styles.formGroupRow}>
                    <div style={{ ...styles.formGroup, flex: 1 }}>
                        <label style={styles.label}>Function Name (URL Slug)</label>
                        <input 
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={mode === 'edit'}
                            placeholder="e.g. acme-calc"
                            style={mode === 'edit' ? styles.inputDisabled : styles.input}
                        />
                    </div>
                    <div style={{ ...styles.formGroup, flex: 2 }}>
                        <label style={styles.label}>Description</label>
                        <input 
                            type="text"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Brief description of function purpose..."
                            style={styles.input}
                        />
                    </div>
                </div>

                {/* Templates Tab Bar */}
                <div style={styles.tabBar}>
                    <button 
                        onClick={() => handleTemplateClick('custom')}
                        style={activeTab === 'custom' ? styles.activeTab : styles.tab}
                    >
                        Custom Code
                    </button>
                    {Object.keys(templates).map(key => (
                        <button
                            key={key}
                            onClick={() => handleTemplateClick(key)}
                            style={activeTab === key ? styles.activeTab : styles.tab}
                        >
                            {templates[key].name}
                        </button>
                    ))}
                </div>

                {/* Monaco Editor Container */}
                <div style={styles.editorContainer}>
                    <Editor 
                        height="100%"
                        language="javascript"
                        theme="vs-light"
                        value={code}
                        onChange={handleCodeChange}
                        onMount={(editor) => console.log('Monaco mounted', editor)}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            lineNumbers: 'on',
                            automaticLayout: true,
                        }}
                    />
                </div>

                {/* Confirm dialogue inline */}
                {showConfirm && (
                    <div style={styles.confirmBox}>
                        <p style={styles.confirmText}>
                            ⚠️ <strong>Warning:</strong> This will update the live function immediately. Continue?
                        </p>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={submitSave} disabled={isSaving} style={styles.confirmBtn}>
                                {isSaving ? 'Saving...' : 'Yes, Save & Update'}
                            </button>
                            <button onClick={() => setShowConfirm(false)} style={styles.cancelConfirmBtn}>
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {/* Footer Buttons */}
                {!showConfirm && (
                    <div style={styles.footer}>
                        <button onClick={onClose} style={styles.cancelBtn}>Cancel</button>
                        <button onClick={handleSaveClick} disabled={isSaving} style={styles.saveBtn}>
                            {isSaving ? 'Saving...' : 'Save & Continue'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

const styles = {
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        justifycontent: 'center',
        alignItems: 'center',
        zIndex: 2000,
    },
    modal: {
        backgroundColor: '#FFFFFF',
        borderRadius: '8px',
        border: '1px solid rgba(0, 0, 0, 0.08)',
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.1)',
        width: '900px',
        maxWidth: '95%',
        maxHeight: '90%',
        display: 'flex',
        flexDirection: 'column',
        padding: '24px',
        boxSizing: 'border-box',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
        paddingBottom: '12px',
    },
    title: {
        margin: 0,
        fontSize: '20px',
        fontWeight: 'bold',
        color: '#1F2937',
    },
    closeBtn: {
        background: 'none',
        border: 'none',
        fontSize: '24px',
        color: '#6B7280',
        cursor: 'pointer',
    },
    errorAlert: {
        backgroundColor: '#FEE2E2',
        border: '1px solid #FCA5A5',
        color: '#991B1B',
        padding: '10px 14px',
        borderRadius: '6px',
        marginBottom: '16px',
        fontSize: '13px',
    },
    formGroupRow: {
        display: 'flex',
        gap: '16px',
        marginBottom: '16px',
    },
    formGroup: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
    },
    label: {
        fontSize: '12px',
        fontWeight: '600',
        color: '#4B5563',
    },
    input: {
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid rgba(0, 0, 0, 0.15)',
        fontSize: '14px',
        outline: 'none',
        boxSizing: 'border-box',
    },
    inputDisabled: {
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid rgba(0, 0, 0, 0.08)',
        backgroundColor: '#F3F4F6',
        color: '#9CA3AF',
        fontSize: '14px',
        boxSizing: 'border-box',
        cursor: 'not-allowed',
    },
    tabBar: {
        display: 'flex',
        gap: '8px',
        borderBottom: '1px solid rgba(0, 0, 0, 0.08)',
        paddingBottom: '8px',
        marginBottom: '16px',
    },
    tab: {
        padding: '6px 12px',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        fontSize: '13px',
        color: '#6B7280',
        borderBottom: '2px solid transparent',
        transition: 'all 0.2s',
    },
    activeTab: {
        padding: '6px 12px',
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        fontSize: '13px',
        color: '#EC1C8D',
        fontWeight: 'bold',
        borderBottom: '2px solid #EC1C8D',
    },
    editorContainer: {
        height: '400px',
        border: '1px solid rgba(0, 0, 0, 0.12)',
        borderRadius: '6px',
        overflow: 'hidden',
        marginBottom: '20px',
    },
    confirmBox: {
        backgroundColor: '#FEF3C7',
        border: '1px solid #FCD34D',
        borderRadius: '6px',
        padding: '12px 16px',
        marginBottom: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    confirmText: {
        margin: 0,
        fontSize: '13px',
        color: '#92400E',
    },
    confirmBtn: {
        backgroundColor: '#D97706',
        color: '#FFFFFF',
        border: 'none',
        borderRadius: '6px',
        padding: '8px 14px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: 'bold',
    },
    cancelConfirmBtn: {
        backgroundColor: '#E5E7EB',
        color: '#374151',
        border: 'none',
        borderRadius: '6px',
        padding: '8px 14px',
        cursor: 'pointer',
        fontSize: '12px',
    },
    footer: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '12px',
    },
    cancelBtn: {
        backgroundColor: '#E5E7EB',
        color: '#374151',
        border: 'none',
        borderRadius: '6px',
        padding: '10px 18px',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: '500',
    },
    saveBtn: {
        backgroundColor: '#EC1C8D',
        color: '#FFFFFF',
        border: 'none',
        borderRadius: '6px',
        padding: '10px 18px',
        cursor: 'pointer',
        fontSize: '14px',
        fontWeight: 'bold',
    }
};

export default CustomFunctionEditor;
