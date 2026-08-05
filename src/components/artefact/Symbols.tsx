import React from 'react';

export type PictogramCode = 'GHS07' | 'GHS09' | 'GHS02';

export const PICTOGRAM_NAMES: Record<PictogramCode, string> = {
  GHS02: 'GHS02, flame',
  GHS07: 'GHS07, exclamation mark',
  GHS09: 'GHS09, environment'
};

/**
 * Standard GHS pictogram: white square set on point, red border, black symbol.
 * Never tinted, rounded or restyled — this is a regulatory artefact.
 */
export function Pictogram({
  code,
  sizeMm = 10,
  title




}: {code: PictogramCode;sizeMm?: number;title?: string;}) {
  return (
    <svg
      width={`${sizeMm}mm`}
      height={`${sizeMm}mm`}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title ?? PICTOGRAM_NAMES[code]}
      style={{ display: 'block', flex: 'none' }}>
      
      <g transform="rotate(45 50 50)">
        <rect x="17" y="17" width="66" height="66" fill="#FFFFFF" stroke="#FF0000" strokeWidth="7" />
      </g>
      <g fill="#000000">{SYMBOLS[code]}</g>
    </svg>);

}

const SYMBOLS: Record<PictogramCode, React.ReactNode> = {
  GHS07:
  <>
      <rect x="45.5" y="30" width="9" height="28" />
      <circle cx="50" cy="66" r="5" />
    </>,

  GHS02:
  <>
      <path d="M50 24c3 9-2 13-6 18-5 6-9 11-9 18a15 15 0 0 0 30 0c0-5-2-9-4-13 4 2 7 5 8 9 3-11-4-24-19-32z" />
      <rect x="30" y="72" width="40" height="5" />
    </>,

  GHS09:
  <>
      <rect x="28" y="70" width="44" height="4" />
      <path d="M31 44c6-7 14-10 21-10 6 0 11 2 15 5l7-8v20l-7-7c-4 3-9 5-15 5-7 0-15-3-21-5z" />
      <circle cx="41" cy="42" r="2.4" fill="#FFFFFF" />
      <path d="M52 28c-1-6 2-11 7-13-2 4-1 7 1 9 3 3 4 6 3 9-2-3-6-4-11-5z" />
      <path d="M60 24c4-2 8-1 10 2-3 0-5 1-6 3-1-2-2-4-4-5z" />
    </>

};

/** EN 15494 candle safety symbols. */
export function CandleSafetySymbols({ sizeMm }: {sizeMm: number;}) {
  return (
    <svg
      width={`${sizeMm * 3.3}mm`}
      height={`${sizeMm}mm`}
      viewBox="0 0 99 30"
      aria-hidden="true"
      style={{ flex: 'none' }}>
      
      {[0, 35, 70].map((x, i) =>
      <g key={x} transform={`translate(${x} 0)`}>
          <circle cx="15" cy="15" r="13.5" fill="#FFFFFF" stroke="#000000" strokeWidth="2" />
          <g fill="none" stroke="#000000" strokeWidth="1.8">
            {i === 0 &&
          <>
                <path d="M15 8c2 3 3 4 3 6a3 3 0 0 1-6 0c0-2 1-3 3-6z" />
                <path d="M11 22h8" />
              </>
          }
            {i === 1 &&
          <>
                <path d="M9 10h12v10H9z" />
                <path d="M12 20v3M18 20v3" />
              </>
          }
            {i === 2 &&
          <>
                <path d="M8 20l7-10 7 10z" />
                <path d="M15 14v3" />
              </>
          }
          </g>
          <path d="M5.5 24.5L24.5 5.5" stroke="#000000" strokeWidth="2" />
        </g>
      )}
    </svg>);

}

/** Period after opening, the open jar symbol. Proportions are fixed. */
