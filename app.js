const DEFAULT_PICKUP = { lat: -17.7554, lng: 177.4434, label: 'Nadi International Airport' };
const DEFAULT_DROPOFF = { lat: -17.7848, lng: 177.4217, label: 'Ramada Suites by Wyndham Wailoaloa Beach Fiji' };

let map;
let directionsService;
let directionsRenderer;
let pickupAutocomplete;
let destinationAutocomplete;
let pickupPlace = DEFAULT_PICKUP;
let destinationPlace = DEFAULT_DROPOFF;

function loadGoogleMaps() {
  const key = localStorage.getItem('googleMapsApiKey') || new URLSearchParams(location.search).get('gmapsKey');
  if (!key) {
    document.getElementById('map-error').hidden = false;
    const entered = prompt('Google Maps APIキーを入力するとルート地図を表示できます。\nこの端末だけに保存します。');
    if (!entered) return;
    localStorage.setItem('googleMapsApiKey', entered.trim());
    location.reload();
    return;
  }

  window.initTaxiMap = initTaxiMap;
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=initTaxiMap`;
  script.async = true;
  script.defer = true;
  script.onerror = () => {
    document.getElementById('map-error').hidden = false;
  };
  document.head.appendChild(script);
}

function initTaxiMap() {
  document.getElementById('map-error').hidden = true;
  map = new google.maps.Map(document.getElementById('map'), {
    center: DEFAULT_PICKUP,
    zoom: 13,
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'greedy',
    mapId: undefined
  });

  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({
    map,
    suppressMarkers: false,
    polylineOptions: { strokeColor: '#111318', strokeOpacity: 0.9, strokeWeight: 5 }
  });

  pickupAutocomplete = new google.maps.places.Autocomplete(document.getElementById('pickup-input'), {
    fields: ['geometry', 'name', 'formatted_address'],
    componentRestrictions: { country: 'fj' }
  });
  destinationAutocomplete = new google.maps.places.Autocomplete(document.getElementById('destination-input'), {
    fields: ['geometry', 'name', 'formatted_address'],
    componentRestrictions: { country: 'fj' }
  });

  pickupAutocomplete.addListener('place_changed', () => {
    const p = pickupAutocomplete.getPlace();
    if (!p.geometry?.location) return;
    pickupPlace = { lat: p.geometry.location.lat(), lng: p.geometry.location.lng(), label: p.name || p.formatted_address };
    renderRoute();
  });

  destinationAutocomplete.addListener('place_changed', () => {
    const p = destinationAutocomplete.getPlace();
    if (!p.geometry?.location) return;
    destinationPlace = { lat: p.geometry.location.lat(), lng: p.geometry.location.lng(), label: p.name || p.formatted_address };
    renderRoute();
  });

  renderRoute();
}

function renderRoute() {
  if (!directionsService || !directionsRenderer) return;
  directionsService.route({
    origin: { lat: pickupPlace.lat, lng: pickupPlace.lng },
    destination: { lat: destinationPlace.lat, lng: destinationPlace.lng },
    travelMode: google.maps.TravelMode.DRIVING,
    provideRouteAlternatives: false
  }).then((result) => {
    directionsRenderer.setDirections(result);
    const leg = result.routes?.[0]?.legs?.[0];
    if (leg) {
      document.getElementById('route-duration').textContent = leg.duration?.text || '—';
      document.getElementById('route-distance').textContent = leg.distance?.text || '';
    }
  }).catch(() => {
    document.getElementById('route-duration').textContent = 'ルート取得失敗';
  });
}

document.getElementById('use-location').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('この端末では位置情報を利用できません。');
  navigator.geolocation.getCurrentPosition((pos) => {
    pickupPlace = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: '現在地' };
    document.getElementById('pickup-input').value = '現在地';
    renderRoute();
  }, () => alert('位置情報の取得を許可してください。'), { enableHighAccuracy: true, timeout: 10000 });
});

document.querySelectorAll('.primary-button').forEach((button) => {
  button.addEventListener('click', () => {
    const driver = button.dataset.driver;
    const fare = button.dataset.fare;
    alert(`${driver}を選択しました。FJ$${fare}の提示額を証拠としてロックします。`);
  });
});

loadGoogleMaps();
