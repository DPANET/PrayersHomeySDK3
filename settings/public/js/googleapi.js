
var componentForm = {
  address: 'address',
  city: 'city',
  coordinates: 'coordinates',
  timezone: 'short_name',
  country: 'time-zone',
};
var autocomplete;
async function getKey()
{
  let key;
  await $.ajax({
    url: `${location.origin}/api/app/com.prayerssapp/Places`,
    // error: genericErrorHandler,
    type: "GET",
    processData:true,
    success: async (value) => {
      key =value;
      return key;
    },
}).catch((jqXHR, textStatus, errorThrown) => { throw new Error(jqXHR.responseJSON.message) });
return key;
}
async function  initMap() {
    const existingScript = document.getElementById('googleMaps');
   // const key = await getKey();
    if (!existingScript) {
      var script = document.createElement('script');
      script.id = 'googleMaps';
     // script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`;
     let data = await getKey();
           //script.src = $.parseHTML(await getKey());
      script.innerHTML = data;
      script.type="text/javascript";

      document.body.appendChild(script );
      
      //script.onload = () => {
        let searchinput = document.getElementById('search-input');
         autocomplete = new google.maps.places.Autocomplete(searchinput,{types:['(cities)']});
        autocomplete.addListener('place_changed', fillInAddress);
      //};

    }
  
    if (existingScript && callback) callback();
  }
initMap();

function fillInAddress()
{
  place= autocomplete.getPlace();
  $("#city").val(place.formatted_address);
  $("#coordinates").val(`(${place.geometry.location.lat()},${place.geometry.location.lng()})`);

}