const FALLBACK = { lat: -17.773, lng: 177.428, label: 'Nadi, Fiji' };
let map;
let pickup = FALLBACK;
let destinationAutocomplete;
let pickupMarker;

function setPickupLabel(text) {
  document.getElementById('pickup-label').textContent = text;
}

function loadGoogleMaps() {
  const key = localStorage.getItem('googleMapsApiKey') || new URLSearchParams(location.search).get('gmapsKey');
  if (!key) {
    document.getElementById('map-error').hidden = false;
    const entered = prompt('Google Maps JavaScript APIキーを入力してください。\nこの端末だけに保存します。');
    if (!entered) return;
    localStorage.setItem('googleMapsApiKey', entered.trim());
    location.reload();
    return;
  }
  window.initHomeMap = initHomeMap;
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=initHomeMap`;
  script.async = true;
  script.defer = true;
  script.onerror = () => document.getElementById('map-error').hidden = false;
  document.head.appendChild(script);
}

function initHomeMap() {
  document.getElementById('map-error').hidden = true;
  map = new google.maps.Map(document.getElementById('map'), {
    center: FALLBACK,
    zoom: 15,
    disableDefaultUI: true,
    gestureHandling: 'greedy',
    styles: [
      { featureType: 'poi', stylers: [{ visibility: 'off' }] },
      { featureType: 'transit', stylers: [{ visibility: 'off' }] }
    ]
  });

  pickupMarker = new google.maps.Marker({
    map,
    position: FALLBACK,
    title: 'Pickup'
  });

  destinationAutocomplete = new google.maps.places.Autocomplete(
    document.getElementById('destination-input'),
    { fields: ['geometry','name','formatted_address'], componentRestrictions: { country: 'fj' } }
  );

  destinationAutocomplete.addListener('place_changed', () => {
    const place = destinationAutocomplete.getPlace();
    if (!place.geometry?.location) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    sessionStorage.setItem('taxiDestination', JSON.stringify({ lat, lng, label: place.name || place.formatted_address || 'Destination' }));
    alert('目的地を設定しました。次画面では車種・料金・評価を比較します。');
  });

  locateUser();
}

function locateUser() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    pickup = { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Current location' };
    map.setCenter(pickup);
    pickupMarker.setPosition(pickup);
    try {
      const geocoder = new google.maps.Geocoder();
      const result = await geocoder.geocode({ location: pickup });
      const address = result.results?.[0]?.formatted_address;
      if (address) setPickupLabel(address.replace(', Fiji',''));
      else setPickupLabel('Current location');
    } catch {
      setPickupLabel('Current location');
    }
  }, () => {
    setPickupLabel('Nadi, Fiji');
  }, { enableHighAccuracy: true, timeout: 10000 });
}

document.querySelectorAll('.recent').forEach((row) => {
  row.addEventListener('click', () => {
    document.getElementById('destination-input').value = row.dataset.place || '';
    document.getElementById('destination-input').focus();
  });
});

document.querySelectorAll('.service-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.service-card').forEach(x => x.classList.remove('active'));
    card.classList.add('active');
  });
});

document.getElementById('schedule-button').addEventListener('click', () => {
  alert('予約日時選択は次の実装で追加します。');
});

loadGoogleMaps();
