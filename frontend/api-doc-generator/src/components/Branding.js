/* frontend/api-doc-generator/src/components/Branding.js */

import React from 'react';
import { brandingConfig } from '../config/branding';

const Branding = () => {
    const { companyName, logoUrl } = brandingConfig;

    return (
        <div className="branding-container" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {logoUrl ? (
                <img 
                    src={logoUrl} 
                    alt={`${companyName} Logo`} 
                    style={{ height: '32px', width: 'auto', objectFit: 'contain' }}
                />
            ) : (
                // Abstract, premium placeholder logo SVG
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect width="32" height="32" rx="6" fill="var(--accent-magenta)" />
                    <path d="M8 10L16 6L24 10L24 22L16 26L8 22V10Z" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
                    <path d="M16 6V26" stroke="white" strokeWidth="2"/>
                    <path d="M8 10L16 14L24 10" stroke="white" strokeWidth="2"/>
                    <path d="M8 22L16 18L24 22" stroke="white" strokeWidth="2"/>
                </svg>
            )}
            <h1 className="header-title" style={{ margin: 0 }}>{companyName}</h1>
        </div>
    );
};

export default Branding;
