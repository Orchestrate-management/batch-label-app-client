import React from 'react';
import { SdsDocumentModel, SdsSection } from '../../lib/sds';

/**
 * The finished-product safety data sheet, rendered at true A4 with real page
 * breaks. Like every regulated surface it sits outside the brand system:
 * white, black, Helvetica, no rounding, no tint.
 */

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_H = PAGE_H - MARGIN * 2 - 10;

/** Rough typeset height in millimetres, used only to place page breaks. */
function estimateHeight(section: SdsSection): number {
  let mm = 9;
  if (section.intro) mm += 6;
  if (section.prompt) mm += 8;
  mm += (section.fields?.length ?? 0) * 4.6;
  mm += (section.lines?.length ?? 0) * 4.2;
  for (const row of section.components ?? []) {
    mm += 9;
    if (row.note) mm += 4;
    mm += (row.constituents?.length ?? 0) * 3.4;
  }
  return mm;
}

function paginate(sections: SdsSection[]): SdsSection[][] {
  const pages: SdsSection[][] = [];
  let page: SdsSection[] = [];
  let used = 0;
  for (const section of sections) {
    const height = estimateHeight(section);
    if (page.length && used + height > CONTENT_H) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(section);
    used += height;
  }
  if (page.length) pages.push(page);
  return pages;
}

const KIND_MARK: Record<SdsSection['kind'], string> = {
  derived: '',
  workspace: '',
  'needs-you': 'To be confirmed'
};

export function SdsDocument({ model }: {model: SdsDocumentModel;}) {
  const pages = paginate(model.sections);

  return (
    <div className="flex flex-col gap-3">
      {pages.map((sections, index) =>
      <div
        key={index}
        className="artefact-surface"
        style={{
          width: `${PAGE_W}mm`,
          height: `${PAGE_H}mm`,
          padding: `${MARGIN}mm`,
          border: '0.2mm solid #000000',
          fontSize: '2.5mm',
          lineHeight: 1.32,
          display: 'flex',
          flexDirection: 'column'
        }}>
        
          <div
          style={{
            borderBottom: '0.4mm solid #000000',
            paddingBottom: '2mm',
            marginBottom: '3mm',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end'
          }}>
          
            <div>
              <div style={{ fontSize: '4mm', fontWeight: 700 }}>Safety data sheet</div>
              <div style={{ marginTop: '0.8mm' }}>
                {model.productName} · {model.supplierName}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '2.2mm' }}>
              <div>
                {model.version} · {model.revisionDate}
              </div>
              <div>
                {model.market === 'GB' ? 'Great Britain' : 'European Union'} · REACH Annex II
              </div>
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'hidden' }}>
            {sections.map((section) =>
          <Section key={section.number} section={section} />
          )}
          </div>

          <div
          style={{
            borderTop: '0.2mm solid #000000',
            paddingTop: '1.6mm',
            marginTop: '2mm',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '2.1mm'
          }}>
          
            <span>Draft for review by a competent person. Not issued until signed.</span>
            <span>
              Page {index + 1} of {pages.length}
            </span>
          </div>
        </div>
      )}
    </div>);

}

function Section({ section }: {section: SdsSection;}) {
  return (
    <section style={{ marginBottom: '3.4mm' }}>
      <h3
        style={{
          fontSize: '2.7mm',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.03em',
          marginBottom: '1.2mm',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
        
        <span>
          Section {section.number}. {section.title}
        </span>
        {KIND_MARK[section.kind] &&
        <span style={{ fontWeight: 400, border: '0.2mm solid #000000', padding: '0 1mm' }}>
            {KIND_MARK[section.kind]}
          </span>
        }
      </h3>

      {section.intro && <p style={{ marginBottom: '1.4mm' }}>{section.intro}</p>}
      {section.prompt &&
      <p style={{ marginBottom: '1.4mm', borderLeft: '0.6mm solid #000000', paddingLeft: '2mm' }}>
          {section.prompt}
        </p>
      }

      {section.fields &&
      <dl style={{ margin: 0 }}>
          {section.fields.map((field) =>
        <div key={field.label} style={{ display: 'flex', gap: '2mm', marginBottom: '0.8mm' }}>
              <dt style={{ width: '46mm', flex: 'none', fontWeight: 700 }}>{field.label}</dt>
              <dd style={{ margin: 0, flex: 1 }}>
                {field.value}
                {field.missing && ' — not on file'}
              </dd>
            </div>
        )}
        </dl>
      }

      {section.lines &&
      <ul style={{ margin: 0, paddingLeft: '4mm' }}>
          {section.lines.map((line) =>
        <li key={line} style={{ marginBottom: '0.6mm' }}>
              {line}
            </li>
        )}
        </ul>
      }

      {section.components &&
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '2.3mm' }}>
          <thead>
            <tr>
              {['Component', 'CAS', 'EC', 'Concentration', 'Classification'].map((heading) =>
            <th
              key={heading}
              style={{
                textAlign: 'left',
                borderBottom: '0.3mm solid #000000',
                padding: '0.8mm 1mm 0.8mm 0',
                fontWeight: 700
              }}>
              
                  {heading}
                </th>
            )}
            </tr>
          </thead>
          <tbody>
            {section.components.length === 0 &&
          <tr>
                <td colSpan={5} style={{ padding: '1.2mm 0' }}>
                  No component is present at a concentration requiring declaration.
                </td>
              </tr>
          }
            {section.components.map((row) =>
          <React.Fragment key={row.name}>
                <tr>
                  <td style={{ padding: '1mm 1mm 0 0', verticalAlign: 'top' }}>{row.name}</td>
                  <td style={{ padding: '1mm 1mm 0 0', verticalAlign: 'top' }}>{row.cas ?? '—'}</td>
                  <td style={{ padding: '1mm 1mm 0 0', verticalAlign: 'top' }}>{row.ec ?? '—'}</td>
                  <td style={{ padding: '1mm 1mm 0 0', verticalAlign: 'top' }}>{row.range}</td>
                  <td style={{ padding: '1mm 0 0 0', verticalAlign: 'top' }}>{row.classification}</td>
                </tr>
                {(row.note || row.constituents) &&
            <tr>
                    <td
                colSpan={5}
                style={{
                  padding: '0.4mm 0 1.2mm 0',
                  borderBottom: '0.15mm solid #000000',
                  fontSize: '2.1mm'
                }}>
                
                      {row.note && <div>{row.note}</div>}
                      {row.constituents &&
                <div style={{ marginTop: '0.5mm' }}>
                          Declarable constituents:{' '}
                          {row.constituents.
                  map(
                    (constituent) =>
                    `${constituent.name} ${constituent.cas ? `(${constituent.cas}) ` : ''}${constituent.pct} %`
                  ).
                  join(', ')}
                          .
                        </div>
                }
                      <div style={{ marginTop: '0.5mm' }}>Source: {row.source}.</div>
                    </td>
                  </tr>
            }
              </React.Fragment>
          )}
          </tbody>
        </table>
      }
    </section>);

}