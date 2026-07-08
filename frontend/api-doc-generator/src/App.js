/* frontend/api-doc-generator/src/App.js */

import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'
import { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import './App.css'
import BrandHeader from './components/BrandHeader'
import CustomFunctionEditor from './components/CustomFunctionEditor'

function App() {
    const [spec, setSpec] = useState(null)
    const [status, setStatus] = useState("Connecting...")
    const [searchQuery, setSearchQuery] = useState("")
    const [selectedCollection, setSelectedCollection] = useState("All")
    const [branding, setBranding] = useState({ companyName: "API Documentation Generator", logoSrc: "/assets/logo-default.svg" })
    const [activeEndpoint, setActiveEndpoint] = useState(null)
    const [collapsedTags, setCollapsedTags] = useState({})
    const [collapsedSchemas, setCollapsedSchemas] = useState({})
    const [showLeftSidebar, setShowLeftSidebar] = useState(false)
    const [showRightRail, setShowRightRail] = useState(false)
    const [editorMode, setEditorMode] = useState(null) // 'create' | 'edit' | null
    const [editingFunctionData, setEditingFunctionData] = useState(null)
    
    const wsRef = useRef(null)
    const centerColumnRef = useRef(null)
    const domMapsRef = useRef({ opMap: new Map(), tagMap: new Map(), schemaMap: new Map() })

    // Helper to normalize path strings to avoid casing/spacing/trailing slash lookup mismatches
    const normalizePath = (p) => {
        if (!p) return '';
        return p.toLowerCase()
                .replace(/\s+/g, '') // Remove all whitespace
                .replace(/\/$/, '')  // Remove trailing slashes
                .trim();
    };

    const makeKey = (method, path) => `${method.toUpperCase()} ${normalizePath(path)}`;

    // Client-side spec filtering resolving recursive $ref schemas
    const filterSpecByTag = (originalSpec, tag) => {
        if (!originalSpec || !tag || tag === 'All') return originalSpec;

        const newSpec = {
            ...originalSpec,
            paths: {},
            components: {
                ...originalSpec.components,
                schemas: {}
            }
        };

        const referencedSchemas = new Set();

        const findRefs = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
                obj.forEach(findRefs);
                return;
            }
            if (obj.$ref && typeof obj.$ref === 'string') {
                const parts = obj.$ref.split('/');
                const schemaName = parts[parts.length - 1];
                if (schemaName) referencedSchemas.add(schemaName);
            }
            Object.keys(obj).forEach(key => {
                if (key !== '$ref') findRefs(obj[key]);
            });
        };

        Object.keys(originalSpec.paths).forEach(path => {
            const pathObj = originalSpec.paths[path];
            const newPathObj = {};
            let hasMatchingOp = false;

            Object.keys(pathObj).forEach(method => {
                const op = pathObj[method];
                if (op && op.tags && op.tags.includes(tag)) {
                    newPathObj[method] = op;
                    hasMatchingOp = true;
                } else if (method === 'parameters') {
                    newPathObj[method] = pathObj[method];
                }
            });

            if (hasMatchingOp) {
                newSpec.paths[path] = newPathObj;
            }
        });

        findRefs(newSpec.paths);

        const schemasToProcess = Array.from(referencedSchemas);
        const processedSchemas = new Set();

        while (schemasToProcess.length > 0) {
            const currentSchemaName = schemasToProcess.shift();
            if (processedSchemas.has(currentSchemaName)) continue;
            processedSchemas.add(currentSchemaName);

            const schemaObj = originalSpec.components?.schemas?.[currentSchemaName];
            if (schemaObj) {
                const beforeCount = referencedSchemas.size;
                findRefs(schemaObj);
                if (referencedSchemas.size > beforeCount) {
                    Array.from(referencedSchemas).forEach(name => {
                        if (!processedSchemas.has(name)) {
                            schemasToProcess.push(name);
                        }
                    });
                }
            }
        }

        if (originalSpec.components && originalSpec.components.schemas) {
            referencedSchemas.forEach(schemaName => {
                const schemaObj = originalSpec.components.schemas[schemaName];
                if (schemaObj) {
                    newSpec.components.schemas[schemaName] = schemaObj;
                }
            });
        }

        return newSpec;
    };

    // Rebuild Swagger UI DOM Map
    const rebuildDOMMaps = () => {
        const opMap = new Map();
        const tagMap = new Map();
        const schemaMap = new Map();

        // 1. Map Operations
        const blocks = document.querySelectorAll('.swagger-ui .opblock');
        blocks.forEach(block => {
            const method = block.querySelector('.opblock-summary-method')?.textContent?.trim()?.toUpperCase();
            const pathEl = block.querySelector('.opblock-summary-path');
            const path = pathEl ? (pathEl.getAttribute('data-path') || pathEl.textContent?.trim()) : '';
            if (method && path) {
                opMap.set(makeKey(method, path), block);
            }
        });

        // 2. Map Tags
        const tagSections = document.querySelectorAll('.swagger-ui .opblock-tag-section');
        tagSections.forEach(section => {
            const header = section.querySelector('.opblock-tag');
            const tagText = header?.querySelector('span')?.textContent?.trim() || header?.textContent?.trim();
            if (tagText) {
                const tagKey = tagText.toLowerCase();
                tagMap.set(tagKey, {
                    section,
                    header,
                    list: section.querySelector('.opblocks-list') || section.querySelector('div:last-child')
                });
            }
        });

        // 3. Map Schemas
        const modelBoxes = document.querySelectorAll('.swagger-ui .model-box, .swagger-ui .model-container');
        modelBoxes.forEach(box => {
            const idAttr = box.getAttribute('id');
            if (idAttr && idAttr.startsWith('model-')) {
                const name = idAttr.replace(/^model-/, '');
                schemaMap.set(name, box);
            } else {
                const control = box.querySelector('.model-box-control');
                const name = control?.textContent?.trim() || box.id?.replace(/^model-/, '');
                if (name) {
                    schemaMap.set(name, box);
                }
            }
        });

        return { opMap, tagMap, schemaMap };
    };

    // Calculate expected operation cards count to resolve MutationObserver race condition
    const getExpectedOpCount = (filteredSpec) => {
        let count = 0;
        if (filteredSpec && filteredSpec.paths) {
            Object.keys(filteredSpec.paths).forEach(path => {
                const pathObj = filteredSpec.paths[path];
                Object.keys(pathObj).forEach(method => {
                    if (['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
                        count++;
                    }
                });
            });
        }
        return count;
    };

    // WebSocket connection handler
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

    const fetchActiveBranding = async () => {
        try {
            const res = await axios.get('http://localhost:3001/api/branding/active')
            setBranding({
                companyName: res.data.companyName || "API Documentation Generator",
                logoSrc: res.data.logoUrl || "/assets/logo-default.svg"
            })
        } catch (err) {
            console.error('Failed to fetch active branding:', err)
        }
    }

    useEffect(() => {
        fetchActiveBranding()
        const interval = setInterval(fetchActiveBranding, 3000)
        return () => clearInterval(interval)
    }, [])

    const fetchSpecManually = async () => {
        try {
            const res = await axios.get('http://localhost:3001/api/openapi')
            setSpec(JSON.parse(res.data.openapi))
            setStatus("Live")
        } catch (err) {
            console.error('Failed to fetch spec:', err)
        }
    }

    const injectEditButtons = () => {
        const blocks = document.querySelectorAll('.swagger-ui .opblock');
        blocks.forEach(block => {
            const pathEl = block.querySelector('.opblock-summary-path');
            if (pathEl) {
                const pathText = pathEl.textContent?.trim() || '';
                if (pathText.startsWith('/custom/')) {
                    const name = pathText.replace(/^\/custom\//, '');
                    
                    const summaryControl = block.querySelector('.opblock-summary') || block.querySelector('.opblock-summary-control');
                    if (summaryControl && !summaryControl.querySelector('.edit-code-btn-custom')) {
                        const btn = document.createElement('button');
                        btn.className = 'edit-code-btn-custom';
                        btn.innerText = '⚙️ Edit Code';
                        btn.type = 'button';
                        Object.assign(btn.style, {
                            marginLeft: '12px',
                            padding: '3px 8px',
                            fontSize: '11px',
                            fontWeight: '600',
                            color: '#EC1C8D',
                            backgroundColor: 'rgba(236, 28, 141, 0.06)',
                            border: '1px solid rgba(236, 28, 141, 0.2)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            zIndex: '10',
                            transition: 'all 0.2s'
                        });

                        btn.onmouseenter = () => {
                            btn.style.backgroundColor = '#EC1C8D';
                            btn.style.color = '#FFFFFF';
                        };
                        btn.onmouseleave = () => {
                            btn.style.backgroundColor = 'rgba(236, 28, 141, 0.06)';
                            btn.style.color = '#EC1C8D';
                        };

                        btn.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            try {
                                const res = await axios.get(`http://localhost:3001/api/custom-functions/${name}`);
                                setEditingFunctionData(res.data);
                                setEditorMode('edit');
                            } catch (err) {
                                console.error('Failed to load custom function details:', err);
                                alert('Failed to load custom function details.');
                            }
                        });

                        pathEl.parentNode.insertBefore(btn, pathEl.nextSibling);
                    }
                }
            }
        });
    };

    const filteredSpec = filterSpecByTag(spec, selectedCollection);

    // Rebuild Maps via MutationObserver only after expected count is reached
    useEffect(() => {
        if (!spec) return;

        const expectedCount = getExpectedOpCount(filteredSpec);

        const observer = new MutationObserver(() => {
            const blocks = document.querySelectorAll('.swagger-ui .opblock');
            if (blocks.length >= expectedCount) {
                domMapsRef.current = rebuildDOMMaps();
            }
            injectEditButtons();
        });

        const wrapper = document.querySelector('.swagger-wrapper');
        if (wrapper) {
            observer.observe(wrapper, { childList: true, subtree: true });
        }

        domMapsRef.current = rebuildDOMMaps();
        injectEditButtons();

        return () => observer.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spec, selectedCollection]);

    // Scroll-Spy to highlight current operation card in left nav
    useEffect(() => {
        const centerCol = centerColumnRef.current;
        if (!centerCol) return;

        const handleScroll = () => {
            const blocks = document.querySelectorAll('.swagger-ui .opblock');
            let nearestBlock = null;
            let minDistance = Infinity;

            blocks.forEach(block => {
                const rect = block.getBoundingClientRect();
                const distance = Math.abs(rect.top - 120);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestBlock = block;
                }
            });

            if (nearestBlock) {
                const method = nearestBlock.querySelector('.opblock-summary-method')?.textContent?.trim();
                const pathEl = nearestBlock.querySelector('.opblock-summary-path');
                const path = pathEl ? (pathEl.getAttribute('data-path') || pathEl.textContent?.trim()) : '';
                if (method && path) {
                    setActiveEndpoint({ method, path });
                }
            }
        };

        centerCol.addEventListener('scroll', handleScroll);
        return () => centerCol.removeEventListener('scroll', handleScroll);
    }, [spec, selectedCollection]);

    // JS helper to toggle styling during active scrolling (auto-fade scrollbars)
    const handleScrollActivity = (e) => {
        const target = e.currentTarget;
        target.classList.add('scrolling');
        if (target.scrollTimeout) clearTimeout(target.scrollTimeout);
        target.scrollTimeout = setTimeout(() => {
            target.classList.remove('scrolling');
        }, 800);
    };

    // Click handler for endpoint navigation links
    const handleEndpointClick = (tag, method, path) => {
        if (selectedCollection !== 'All' && selectedCollection !== tag) {
            setSelectedCollection(tag);
            setTimeout(() => {
                scrollToOperation(method, path);
            }, 300);
        } else {
            scrollToOperation(method, path);
        }
    };

    // Scroll to operation block (utilizing Just-In-Time maps rebuild for safety)
    const scrollToOperation = (method, path) => {
        const latestMaps = rebuildDOMMaps();
        domMapsRef.current = latestMaps;

        const key = makeKey(method, path);
        const targetBlock = latestMaps.opMap.get(key);
        
        if (targetBlock) {
            if (!targetBlock.classList.contains('is-open')) {
                const summary = targetBlock.querySelector('.opblock-summary') || targetBlock.querySelector('.opblock-summary-control');
                summary?.click();
            }
            targetBlock.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setShowLeftSidebar(false);
        } else {
            console.warn(`[API Docs] Could not find operation DOM node for key: ${key}`);
        }
    };

    // Scroll to schema box (utilizing Just-In-Time maps rebuild for safety)
    const scrollToSchema = (schemaName) => {
        const latestMaps = rebuildDOMMaps();
        domMapsRef.current = latestMaps;

        const targetEl = latestMaps.schemaMap.get(schemaName);
        
        if (targetEl) {
            const control = targetEl.querySelector('.model-box-control') || targetEl;
            if (control && control.getAttribute('aria-expanded') === 'false') {
                control.click();
            }
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setShowRightRail(false);
        } else {
            console.warn(`[API Docs] Could not find schema DOM node for name: ${schemaName}`);
        }
    };

    // Extract tags/operations list from spec
    const getGroupedEndpoints = () => {
        const groups = {};
        if (spec && spec.paths) {
            Object.keys(spec.paths).forEach(path => {
                const pathObj = spec.paths[path];
                Object.keys(pathObj).forEach(method => {
                    if (!['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) return;
                    
                    const op = pathObj[method];
                    const tag = op.tags && op.tags[0] ? op.tags[0] : 'general';
                    if (!groups[tag]) groups[tag] = [];
                    groups[tag].push({
                        path,
                        method: method.toUpperCase(),
                        summary: op.summary || `${method.toUpperCase()} ${path}`
                    });
                });
            });
        }
        return groups;
    };

    // Sidebar tag chevron click (updates collapsed state via single-source-of-truth Set/Object)
    const toggleTag = (tag) => {
        setCollapsedTags(prev => {
            const nextVal = !prev[tag];
            
            // Programmatically click Swagger UI tag header
            const tagInfo = domMapsRef.current?.tagMap?.get(tag.toLowerCase());
            if (tagInfo) {
                const isDOMCollapsed = !tagInfo.section.classList.contains('opblock-tag-section-open');
                if (nextVal !== isDOMCollapsed) {
                    const btn = tagInfo.header.querySelector('button') || tagInfo.header;
                    btn?.click();
                }
            }

            return {
                ...prev,
                [tag]: nextVal
            };
        });
    };

    // Intercept native user clicks in Swagger UI to update React state (guarded by isTrusted check to prevent loop)
    const handleCenterColumnClick = (e) => {
        if (!e.nativeEvent.isTrusted) return; // Prevent programmatic click feedback loop!
        
        const tagHeader = e.target.closest('.opblock-tag');
        if (tagHeader) {
            const tagText = tagHeader.querySelector('span')?.textContent?.trim() || tagHeader.textContent?.trim();
            if (tagText) {
                const tag = tagText.toLowerCase();
                setTimeout(() => {
                    const tagInfo = domMapsRef.current?.tagMap?.get(tag);
                    if (tagInfo) {
                        const isDOMCollapsed = !tagInfo.section.classList.contains('opblock-tag-section-open');
                        setCollapsedTags(prev => {
                            if (prev[tag] !== isDOMCollapsed) {
                                return {
                                    ...prev,
                                    [tag]: isDOMCollapsed
                                };
                            }
                            return prev;
                        });
                    }
                }, 50);
            }
        }
    };

    const isDotActive = status === "Live" || status.startsWith("Connected");
    const grouped = getGroupedEndpoints();
    const filteredGroups = {};
    
    // Search filtering matching collection/tag names only
    Object.keys(grouped).forEach(tag => {
        if (searchQuery.trim() === "") {
            filteredGroups[tag] = grouped[tag];
        } else {
            if (tag.toLowerCase().includes(searchQuery.toLowerCase())) {
                filteredGroups[tag] = grouped[tag];
            }
        }
    });

    const schemaKeys = spec && spec.components && spec.components.schemas 
        ? Object.keys(spec.components.schemas) 
        : [];

    const collectionsList = Object.keys(grouped);
    const sortedCols = [...collectionsList].sort((a, b) => b.length - a.length);

    const schemaGroups = {};
    schemaKeys.forEach(key => {
        let matchedCol = null;
        for (const col of sortedCols) {
            const singular = col.endsWith('s') ? col.slice(0, -1) : col;
            const capSingular = singular.charAt(0).toUpperCase() + singular.slice(1);
            const capPlural = col.charAt(0).toUpperCase() + col.slice(1);
            
            if (key === col || key === capPlural || key.includes(capSingular) || key.includes(capPlural) || key.toLowerCase().includes(singular.toLowerCase())) {
                matchedCol = col;
                break;
            }
        }
        
        const groupName = matchedCol || 'other';
        if (!schemaGroups[groupName]) schemaGroups[groupName] = [];
        schemaGroups[groupName].push(key);
    });

    // Format schemas and associate Create/Update variants as nested sub-links
    const getGroupedSchemaItems = (groupKeys) => {
        const baseSchemas = groupKeys.filter(name => !name.startsWith('Create') && !name.startsWith('Update'));
        const variants = groupKeys.filter(name => name.startsWith('Create') || name.startsWith('Update'));
        
        const renderedVariants = new Set();
        const items = [];
        
        baseSchemas.forEach(baseName => {
            const matchingCreate = `Create${baseName}`;
            const matchingUpdate = `Update${baseName}`;
            
            const subLinks = [];
            if (variants.includes(matchingCreate)) {
                subLinks.push({ name: `Create ${baseName}`, fullName: matchingCreate });
                renderedVariants.add(matchingCreate);
            }
            if (variants.includes(matchingUpdate)) {
                subLinks.push({ name: `Update ${baseName}`, fullName: matchingUpdate });
                renderedVariants.add(matchingUpdate);
            }
            
            items.push({
                primary: baseName,
                subLinks
            });
        });
        
        groupKeys.forEach(name => {
            if (!baseSchemas.includes(name) && !renderedVariants.has(name)) {
                items.push({
                    primary: name,
                    subLinks: []
                });
            }
        });
        
        return items;
    };

    // Toggle schema collapse status (collapsedSchemas[tag] !== false is collapsed)
    const toggleSchemaTag = (tag) => {
        setCollapsedSchemas(prev => ({
            ...prev,
            [tag]: prev[tag] === false ? true : false
        }));
    };

    return (
        <div className="app-container">
            {/* 0. APP HEADER */}
            <header className="custom-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button 
                        className="menu-toggle-btn left-toggle" 
                        onClick={() => setShowLeftSidebar(true)}
                    >
                        ☰
                    </button>
                    <BrandHeader branding={branding} />
                </div>
                <div className="header-actions">
                    <div className="status-badge">
                        <span className={`status-dot ${isDotActive ? 'status-dot-active' : ''}`}></span>
                        <span className="status-text">{status}</span>
                    </div>
                    <button 
                        className="menu-toggle-btn right-toggle" 
                        onClick={() => setShowRightRail(true)}
                    >
                        ⓘ
                    </button>
                </div>
            </header>

            <div className="app-layout">
                {/* Sidebar mobile overlays */}
                {(showLeftSidebar || showRightRail) && (
                    <div 
                        className={`sidebar-overlay ${showLeftSidebar ? 'left-open' : ''} ${showRightRail ? 'right-open' : ''}`}
                        onClick={() => {
                            setShowLeftSidebar(false)
                            setShowRightRail(false)
                        }}
                    />
                )}

                {/* 1. LEFT SIDEBAR */}
                <aside className={`left-sidebar ${showLeftSidebar ? 'open' : ''}`} onScroll={handleScrollActivity}>
                    <div className="search-container">
                        <input 
                            type="text" 
                            className="search-input" 
                            placeholder="Search collections..." 
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <div className="nav-scrollable">
                        <div 
                            className={`tag-header ${selectedCollection === 'All' ? 'active' : ''}`}
                            onClick={() => {
                                setSelectedCollection('All')
                                setShowLeftSidebar(false)
                            }}
                            style={{ marginBottom: '16px' }}
                        >
                            <span className="tag-title">All Collections</span>
                        </div>

                        {Object.keys(filteredGroups).map(tag => {
                            const isCollapsed = searchQuery.trim() !== "" ? false : !!collapsedTags[tag];
                            const isSelected = selectedCollection === tag;
                            return (
                                <div className="tag-group" key={tag}>
                                    <div className={`tag-header ${isSelected ? 'active' : ''}`}>
                                        <span 
                                            className="tag-title" 
                                            onClick={() => {
                                                setSelectedCollection(tag)
                                                setShowLeftSidebar(false)
                                            }}
                                            style={{ flex: 1 }}
                                        >
                                            {tag}
                                        </span>
                                        <span 
                                            className={`tag-arrow ${isCollapsed ? 'collapsed' : ''}`}
                                            onClick={(e) => {
                                                e.stopPropagation()
                                                toggleTag(tag)
                                            }}
                                            style={{ padding: '4px 8px' }}
                                        >
                                            ▼
                                        </span>
                                    </div>
                                    {!isCollapsed && (
                                        <div className="endpoint-list">
                                            {tag === 'Custom Functions' && (
                                                <div 
                                                    className="endpoint-item new-function-item"
                                                    onClick={() => {
                                                        setEditingFunctionData(null);
                                                        setEditorMode('create');
                                                        setShowLeftSidebar(false);
                                                    }}
                                                    style={{
                                                        color: '#EC1C8D',
                                                        fontWeight: 'bold',
                                                        borderBottom: '1px dashed rgba(0,0,0,0.08)',
                                                        paddingBottom: '8px',
                                                        marginBottom: '8px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <span style={{ fontSize: '16px' }}>+</span>
                                                    <span>New Function</span>
                                                </div>
                                            )}
                                            {filteredGroups[tag].map(op => {
                                                const isActive = activeEndpoint && 
                                                               activeEndpoint.method === op.method && 
                                                               activeEndpoint.path === op.path;
                                                return (
                                                    <div 
                                                        className={`endpoint-item ${isActive ? 'active' : ''}`}
                                                        key={`${op.method}-${op.path}`}
                                                        onClick={() => handleEndpointClick(tag, op.method, op.path)}
                                                    >
                                                        <span className={`method-badge ${op.method.toLowerCase()}`}>
                                                            {op.method}
                                                        </span>
                                                        <span className="endpoint-summary" title={op.summary}>
                                                            {op.summary}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </aside>

                {/* 2. CENTER COLUMN */}
                <main 
                    className="center-column" 
                    ref={centerColumnRef} 
                    onScroll={(e) => {
                        handleScrollActivity(e)
                    }}
                    onClick={handleCenterColumnClick}
                >
                    <div className="swagger-wrapper">
                        { filteredSpec ? <SwaggerUI spec={filteredSpec} /> : <p className="loading-text">Loading docs...</p> }
                    </div>
                </main>

                {/* 3. RIGHT RAIL */}
                <aside className={`right-rail ${showRightRail ? 'open' : ''}`} onScroll={handleScrollActivity}>
                    <div className="rail-card">
                        <h2 className="branding-title">API Docs Portal</h2>
                        <p className="branding-desc">Dynamic OpenAPI interactive developer portal.</p>
                        
                        <div className="metadata-row">
                            <span className="metadata-label">Environment</span>
                            <span className="metadata-value">Standalone / Live</span>
                        </div>
                        {spec?.info?.version && (
                            <div className="metadata-row">
                                <span className="metadata-label">API Version</span>
                                <span className="metadata-value">{spec.info.version}</span>
                            </div>
                        )}
                    </div>

                    {Object.keys(schemaGroups).length > 0 && (
                        <div className="rail-card">
                            <div className="rail-card-title">Schemas</div>
                            <div className="rail-card-subtitle">
                                Data models used in request and response bodies.
                            </div>
                            <div className="schema-list">
                                {Object.keys(schemaGroups).map(tag => {
                                    const isCollapsed = collapsedSchemas[tag] !== false; // collapsed by default
                                    const groupItems = getGroupedSchemaItems(schemaGroups[tag]);
                                    if (groupItems.length === 0) return null;

                                    return (
                                        <div className="tag-group" key={tag} style={{ marginBottom: '10px' }}>
                                            <div className="tag-header" onClick={() => toggleSchemaTag(tag)} style={{ padding: '6px 10px' }}>
                                                <span style={{ fontSize: '12px' }}>{tag}</span>
                                                <span className={`tag-arrow ${isCollapsed ? 'collapsed' : ''}`} style={{ fontSize: '8px' }}>▼</span>
                                            </div>
                                            {!isCollapsed && (
                                                <div className="endpoint-list" style={{ marginTop: '4px', gap: '6px' }}>
                                                    {groupItems.map(item => (
                                                        <div key={item.primary} style={{ display: 'flex', flexDirection: 'column' }}>
                                                            <div 
                                                                className="schema-link"
                                                                onClick={() => scrollToSchema(item.primary)}
                                                            >
                                                                <span className="schema-icon">❖</span>
                                                                <span style={{ fontWeight: item.subLinks.length > 0 ? '600' : 'normal' }}>
                                                                    {item.primary}
                                                                </span>
                                                            </div>
                                                            {item.subLinks.length > 0 && (
                                                                <div className="schema-sub-list">
                                                                    {item.subLinks.map(sub => (
                                                                        <div 
                                                                            className="schema-sub-link"
                                                                            key={sub.fullName}
                                                                            onClick={() => scrollToSchema(sub.fullName)}
                                                                        >
                                                                            {sub.name}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="rail-card">
                        <div className="rail-card-title">Interactive Console</div>
                        <p className="info-card-text">
                            Use the "Try it out" button inside any operation card in the center column to execute requests.
                        </p>
                        <p className="info-card-text" style={{ marginTop: '8px' }}>
                            Endpoints requiring authorization display a lock icon (🔒) in their operations bar.
                        </p>
                    </div>
                </aside>
            </div>

            {editorMode && (
                <CustomFunctionEditor 
                    mode={editorMode}
                    existingData={editingFunctionData}
                    onClose={() => {
                        setEditorMode(null)
                        setEditingFunctionData(null)
                    }}
                    onSaved={() => {
                        setEditorMode(null)
                        setEditingFunctionData(null)
                        fetchSpecManually()
                    }}
                />
            )}
        </div>
    )
}

export default App