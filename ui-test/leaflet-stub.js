(function(){
 const mapObj={fitBounds(){return this},setView(){return this},panTo(){return this},on(){return this},closePopup(){return this}};
 const layer=()=>({addTo(){return this},bindPopup(){return this},remove(){return this}});
 window.L={map(){return mapObj},tileLayer(){return layer()},divIcon(o){return o},marker(){return layer()},polyline(){return layer()}};
})();
