/* frontend/api-doc-generator/src/components/BrandHeader.js */

import React, { useState, useEffect } from 'react';

const BrandHeader = ({ branding }) => {
    const companyName = branding?.companyName || "API Documentation Generator";
    const logoSrc = branding?.logoSrc || "/assets/logo-default.svg";

    const [imgSrc, setImgSrc] = useState(logoSrc);
    const [useFallback, setUseFallback] = useState(!logoSrc);

    useEffect(() => {
        setImgSrc(logoSrc);
        setUseFallback(!logoSrc);
    }, [logoSrc]);

    const handleError = () => {
        setUseFallback(true);
    };

    return (
        <div className="branding-container" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {useFallback ? (
                // Abstract, premium placeholder logo SVG (existing pink cube as fallback)
                <svg width="36" height="36" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
                    <rect width="32" height="32" rx="6" fill="var(--accent-magenta)" />
                    <path d="M8 10L16 6L24 10L24 22L16 26L8 22V10Z" stroke="white" strokeWidth="2" strokeLinejoin="round"/>
                    <path d="M16 6V26" stroke="white" strokeWidth="2"/>
                    <path d="M8 10L16 14L24 10" stroke="white" strokeWidth="2"/>
                    <path d="M8 22L16 18L24 22" stroke="white" strokeWidth="2"/>
                </svg>
            ) : (
                <img 
                    src={imgSrc} 
                    alt={`${companyName} Logo`} 
                    onError={handleError}
                    style={{ 
                        height: '36px', 
                        width: '36px', 
                        objectFit: 'contain', 
                        borderRadius: '6px',
                        flexShrink: 0
                    }}
                />
            )}
            <h1 className="header-title" style={{ margin: 0, fontWeight: 'bold' }}>{companyName}</h1>
        </div>
    );
};

export default BrandHeader;
