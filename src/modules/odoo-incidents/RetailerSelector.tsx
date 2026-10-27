import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import liverpoolLogo from '@/assets/ppt/liverpool.png';
import chedrauiLogo from '@/assets/retailers/chedraui.png';
import sanPabloLogo from '@/assets/retailers/farmacias-san-pablo.png';
import laComerLogo from '@/assets/retailers/la-comer.png';
import { BrandLogo } from '@/components/BrandLogo';
import { RETAILER_BRANDS, type RetailerBrand } from './retailerBrands';

const LOGOS: Record<string, string> = {
  Chedraui: chedrauiLogo,
  'La Comer': laComerLogo,
  'Farmacias San Pablo': sanPabloLogo,
};

function RetailerMark({ brand }: { brand: RetailerBrand }) {
  if (brand.value === '')
    return (
      <span aria-hidden="true" className="odoo-retailer-instore">
        <BrandLogo variant="current" height={22} />
      </span>
    );
  if (brand.value === 'Liverpool')
    return (
      <span
        aria-hidden="true"
        className="odoo-retailer-logo"
        style={{
          WebkitMaskImage: `url(${liverpoolLogo})`,
          maskImage: `url(${liverpoolLogo})`,
        }}
      />
    );
  return (
    <img
      className="odoo-retailer-img"
      src={LOGOS[brand.value]}
      alt=""
      draggable={false}
    />
  );
}

/**
 * Selector de retailer como tarjetas de marca: el marco activo se desliza
 * entre tarjetas y la seleccionada recupera su color. Accesible como grupo de
 * radios (flechas para moverse, Tab entra en la opción activa).
 */
export function RetailerSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [frame, setFrame] = useState<CSSProperties>({ opacity: 0 });
  const activeIndex = Math.max(
    0,
    RETAILER_BRANDS.findIndex((brand) => brand.value === value),
  );

  useLayoutEffect(() => {
    const place = () => {
      const button = refs.current[activeIndex];
      if (!button) return;
      setFrame({
        width: button.offsetWidth,
        height: button.offsetHeight,
        transform: `translate(${button.offsetLeft}px, ${button.offsetTop}px)`,
        opacity: 1,
      });
    };
    place();
    refs.current[activeIndex]?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
      behavior: 'smooth',
    });
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(place);
    const parent = refs.current[0]?.parentElement;
    if (parent) observer.observe(parent);
    return () => observer.disconnect();
  }, [activeIndex]);

  const select = (index: number) => {
    const brand = RETAILER_BRANDS[index];
    if (!brand) return;
    onChange(brand.value);
    refs.current[index]?.focus();
  };

  return (
    <div className="odoo-retailers" role="radiogroup" aria-label="Retailer">
      <span className="odoo-retailer-frame" aria-hidden="true" style={frame} />
      {RETAILER_BRANDS.map((brand, index) => {
        const checked = index === activeIndex;
        return (
          <button
            key={brand.label}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={`odoo-retailer${checked ? ' is-active' : ''}`}
            style={{ '--brand': brand.color } as CSSProperties}
            onClick={() => onChange(brand.value)}
            onKeyDown={(event) => {
              const step =
                event.key === 'ArrowRight' || event.key === 'ArrowDown'
                  ? 1
                  : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? -1
                    : 0;
              if (!step) return;
              event.preventDefault();
              const total = RETAILER_BRANDS.length;
              select((index + step + total) % total);
            }}
          >
            <span className="odoo-retailer-tile">
              <RetailerMark brand={brand} />
            </span>
            <span className="odoo-retailer-name">{brand.label}</span>
          </button>
        );
      })}
    </div>
  );
}
