/* WindFoil — Wind-Partikel-Animation (Canvas-Overlay über Leaflet-Karte)
 * Jeder Spot spawnt Partikel, die in Windrichtung fließen (TO-Richtung).
 * Konvention: `dir` = meteorologische VON-Richtung (z. B. WSW = 247°)
 * Toggle-Button wird als natives Leaflet-Control unten links eingebunden. */
(function (root) {
  'use strict';

  var PER_SPOT_DESKTOP = 20;
  var PER_SPOT_MOBILE  = 10;

  function perSpot() {
    return window.innerWidth < 600 ? PER_SPOT_MOBILE : PER_SPOT_DESKTOP;
  }

  function WindParticles(map) {
    this.map       = map;
    this.spots     = [];
    this.particles = [];
    this.raf       = null;
    this.enabled   = true;
    this._prevProj = null;
    this._canvas   = null;
    this._ctx      = null;
    this._btn      = null;
    this._attach();
  }

  WindParticles.prototype._attach = function () {
    // ── Canvas overlay ──────────────────────────────────────────────────────
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:649';
    this.map.getContainer().appendChild(canvas);
    this._canvas = canvas;
    this._ctx    = canvas.getContext('2d');
    this._resize();

    // ── Toggle als Leaflet-Control (bottom-left, nativ integriert) ──────────
    var self = this;
    if (typeof L !== 'undefined' && L.Control) {
      var Ctrl = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function () {
          var wrap = L.DomUtil.create('div', 'leaflet-bar leaflet-control wp-ctrl');
          wrap.style.cssText = 'background:#1a2535;border:1px solid #2a3f5a;border-radius:8px;overflow:hidden';
          var a = L.DomUtil.create('a', '', wrap);
          a.href  = '#';
          a.title = 'Windanimation ein/aus';
          a.setAttribute('role', 'button');
          a.setAttribute('aria-label', 'Windanimation ein/aus');
          a.style.cssText = [
            'display:flex', 'align-items:center', 'gap:5px',
            'padding:6px 10px', 'font-size:13px', 'font-weight:600',
            'color:#3a9ad9', 'text-decoration:none', 'white-space:nowrap',
            'font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif',
          ].join(';');
          a.innerHTML = '💨 Wind';
          L.DomEvent.disableClickPropagation(wrap);
          L.DomEvent.on(a, 'click', function (e) {
            L.DomEvent.preventDefault(e);
            self.toggle();
          });
          self._btn = a;
          return wrap;
        },
        onRemove: function () {}
      });
      new Ctrl().addTo(this.map);
    } else {
      // Fallback: absolut positioniert, knapp über der Leaflet-Attribution
      var btn = document.createElement('button');
      btn.setAttribute('title', 'Windanimation ein/aus');
      btn.setAttribute('aria-label', 'Windanimation ein/aus');
      btn.innerHTML = '💨 Wind';
      btn.style.cssText = [
        'position:absolute', 'bottom:34px', 'left:10px', 'z-index:1000',
        'background:#1a2535', 'border:1px solid #2a3f5a', 'border-radius:8px',
        'padding:6px 10px', 'cursor:pointer', 'font-size:13px', 'font-weight:600',
        'color:#3a9ad9', 'line-height:1.2',
      ].join(';');
      btn.addEventListener('click', function () { self.toggle(); });
      this.map.getContainer().appendChild(btn);
      this._btn = btn;
    }

    // ── Map-Events ──────────────────────────────────────────────────────────
    this.map.on('resize',    this._resize.bind(this));
    this.map.on('movestart', this._onMoveStart.bind(this));
    this.map.on('move',      this._onMove.bind(this));
    this.map.on('zoomend',   this._onZoomEnd.bind(this));
  };

  WindParticles.prototype._resize = function () {
    var c = this.map.getContainer();
    this._canvas.width  = c.clientWidth;
    this._canvas.height = c.clientHeight;
  };

  WindParticles.prototype._onMoveStart = function () {
    this._prevProj = this.map.project(this.map.getCenter(), this.map.getZoom());
  };

  WindParticles.prototype._onMove = function () {
    if (!this._prevProj) return;
    var zoom    = this.map.getZoom();
    var newProj = this.map.project(this.map.getCenter(), zoom);
    var dx = this._prevProj.x - newProj.x;
    var dy = this._prevProj.y - newProj.y;
    for (var i = 0; i < this.particles.length; i++) {
      this.particles[i].x += dx;
      this.particles[i].y += dy;
    }
    this._prevProj = newProj;
  };

  WindParticles.prototype._onZoomEnd = function () {
    if (this.spots.length) this._initParticles();
  };

  /* spotData = [{ lat, lon, dir, speedKn }]  — dir ist VON-Richtung */
  WindParticles.prototype.setSpots = function (spotData) {
    this.spots = spotData.filter(function (s) {
      return s.dir != null && Number.isFinite(s.dir);
    });
    this._initParticles();
    if (this.enabled && !this.raf) this._loop();
  };

  WindParticles.prototype._initParticles = function () {
    this.particles = [];
    var n = perSpot();
    for (var i = 0; i < this.spots.length; i++) {
      for (var j = 0; j < n; j++) {
        this.particles.push(this._spawn(this.spots[i], true));
      }
    }
  };

  WindParticles.prototype._spawn = function (spot, rand) {
    var pt     = this.map.latLngToContainerPoint([spot.lat, spot.lon]);
    var spread = 60;
    var life   = 50 + Math.random() * 60;
    return {
      spot : spot,
      x    : pt.x + (Math.random() - 0.5) * spread * 2,
      y    : pt.y + (Math.random() - 0.5) * spread * 2,
      age  : rand ? Math.floor(Math.random() * life) : 0,
      life : life,
    };
  };

  WindParticles.prototype._step = function () {
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      var toRad = ((p.spot.dir + 180) % 360) * Math.PI / 180;
      var vel   = Math.max(0.5, p.spot.speedKn) * 0.1;
      p.x  += Math.sin(toRad) * vel;
      p.y  -= Math.cos(toRad) * vel;
      p.age++;

      if (p.age >= p.life) {
        var pt     = this.map.latLngToContainerPoint([p.spot.lat, p.spot.lon]);
        var spread = 60;
        p.x    = pt.x + (Math.random() - 0.5) * spread * 2;
        p.y    = pt.y + (Math.random() - 0.5) * spread * 2;
        p.age  = 0;
        p.life = 50 + Math.random() * 60;
      }
    }
  };

  WindParticles.prototype._draw = function () {
    var ctx = this._ctx;
    ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);

    for (var i = 0; i < this.particles.length; i++) {
      var p   = this.particles[i];
      var t   = p.age / p.life;
      var alpha = t < 0.15 ? t / 0.15 : (t > 0.80 ? (1 - t) / 0.20 : 1);
      alpha *= 0.70;

      var spd = p.spot.speedKn;
      var r, g, b;
      if (spd < 12)      { r = 58;  g = 154; b = 217; }
      else if (spd < 22) { r = 61;  g = 210; b = 190; }
      else               { r = 245; g = 185; b = 66;  }

      var size = 1.5 + Math.min(spd, 35) * 0.05;

      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, 6.2832);
      ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha.toFixed(2) + ')';
      ctx.fill();
    }
  };

  WindParticles.prototype._loop = function () {
    if (!this.enabled) return;
    this._step();
    this._draw();
    var self = this;
    this.raf = requestAnimationFrame(function () { self._loop(); });
  };

  WindParticles.prototype.toggle = function () {
    this.enabled = !this.enabled;
    if (this._btn) {
      this._btn.style.color   = this.enabled ? '#3a9ad9' : '#5a7a96';
      this._btn.style.opacity = this.enabled ? '1'       : '0.5';
    }
    if (this.enabled) {
      this._loop();
    } else {
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
      this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    }
  };

  WindParticles.prototype.destroy = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.map.off('resize',    this._resize.bind(this));
    this.map.off('movestart', this._onMoveStart.bind(this));
    this.map.off('move',      this._onMove.bind(this));
    this.map.off('zoomend',   this._onZoomEnd.bind(this));
    if (this._canvas) this._canvas.remove();
    if (this._btn)    this._btn.closest('.wp-ctrl') && this._btn.closest('.wp-ctrl').remove();
  };

  root.WindParticles = WindParticles;

})(typeof globalThis !== 'undefined' ? globalThis : this);
