import React from 'react';
import logoMark from '../assets/logo-mark.png';

/** Inno Source logo tile + title, used on the start-up screens. */
export default function BrandHead({ title, as: H = 'h1' }) {
  return (
    <div className="brand-head">
      <span className="logo-tile"><img src={logoMark} alt="Inno Source" /></span>
      <div>
        <H>{title}</H>
        <div className="byline">InnoForge POS · by <b>Inno Source</b></div>
      </div>
    </div>
  );
}
