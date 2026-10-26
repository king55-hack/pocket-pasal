/** Nepal's 7 provinces and 77 districts, so the setup form can offer a pick list instead of free typing. */
export interface Province { id: string; ne: string; en: string; districts: [string, string][] }

export const PROVINCES: Province[] = [
  { id: 'koshi', ne: 'कोशी प्रदेश', en: 'Koshi', districts: [['भोजपुर', 'Bhojpur'], ['धनकुटा', 'Dhankuta'], ['इलाम', 'Ilam'], ['झापा', 'Jhapa'], ['खोटाङ', 'Khotang'], ['मोरङ', 'Morang'], ['ओखलढुङ्गा', 'Okhaldhunga'], ['पाँचथर', 'Panchthar'], ['सङ्खुवासभा', 'Sankhuwasabha'], ['सोलुखुम्बु', 'Solukhumbu'], ['सुनसरी', 'Sunsari'], ['ताप्लेजुङ', 'Taplejung'], ['तेह्रथुम', 'Terhathum'], ['उदयपुर', 'Udayapur']] },
  { id: 'madhesh', ne: 'मधेश प्रदेश', en: 'Madhesh', districts: [['सप्तरी', 'Saptari'], ['सिरहा', 'Siraha'], ['धनुषा', 'Dhanusha'], ['महोत्तरी', 'Mahottari'], ['सर्लाही', 'Sarlahi'], ['रौतहट', 'Rautahat'], ['बारा', 'Bara'], ['पर्सा', 'Parsa']] },
  { id: 'bagmati', ne: 'बागमती प्रदेश', en: 'Bagmati', districts: [['सिन्धुली', 'Sindhuli'], ['रामेछाप', 'Ramechhap'], ['दोलखा', 'Dolakha'], ['सिन्धुपाल्चोक', 'Sindhupalchok'], ['काभ्रेपलाञ्चोक', 'Kavrepalanchok'], ['ललितपुर', 'Lalitpur'], ['भक्तपुर', 'Bhaktapur'], ['काठमाडौँ', 'Kathmandu'], ['नुवाकोट', 'Nuwakot'], ['रसुवा', 'Rasuwa'], ['धादिङ', 'Dhading'], ['मकवानपुर', 'Makwanpur'], ['चितवन', 'Chitwan']] },
  { id: 'gandaki', ne: 'गण्डकी प्रदेश', en: 'Gandaki', districts: [['गोरखा', 'Gorkha'], ['लमजुङ', 'Lamjung'], ['तनहुँ', 'Tanahun'], ['स्याङ्जा', 'Syangja'], ['कास्की', 'Kaski'], ['मनाङ', 'Manang'], ['मुस्ताङ', 'Mustang'], ['म्याग्दी', 'Myagdi'], ['पर्वत', 'Parbat'], ['बागलुङ', 'Baglung'], ['नवलपुर', 'Nawalpur']] },
  { id: 'lumbini', ne: 'लुम्बिनी प्रदेश', en: 'Lumbini', districts: [['परासी', 'Parasi'], ['रुपन्देही', 'Rupandehi'], ['कपिलवस्तु', 'Kapilvastu'], ['पाल्पा', 'Palpa'], ['अर्घाखाँची', 'Arghakhanchi'], ['गुल्मी', 'Gulmi'], ['प्यूठान', 'Pyuthan'], ['रोल्पा', 'Rolpa'], ['पूर्वी रुकुम', 'Eastern Rukum'], ['दाङ', 'Dang'], ['बाँके', 'Banke'], ['बर्दिया', 'Bardiya']] },
  { id: 'karnali', ne: 'कर्णाली प्रदेश', en: 'Karnali', districts: [['पश्चिम रुकुम', 'Western Rukum'], ['सल्यान', 'Salyan'], ['डोल्पा', 'Dolpa'], ['हुम्ला', 'Humla'], ['जुम्ला', 'Jumla'], ['कालिकोट', 'Kalikot'], ['मुगु', 'Mugu'], ['सुर्खेत', 'Surkhet'], ['दैलेख', 'Dailekh'], ['जाजरकोट', 'Jajarkot']] },
  { id: 'sudurpashchim', ne: 'सुदूरपश्चिम प्रदेश', en: 'Sudurpashchim', districts: [['बझाङ', 'Bajhang'], ['बाजुरा', 'Bajura'], ['अछाम', 'Achham'], ['डोटी', 'Doti'], ['कैलाली', 'Kailali'], ['कञ्चनपुर', 'Kanchanpur'], ['डडेल्धुरा', 'Dadeldhura'], ['बैतडी', 'Baitadi'], ['दार्चुला', 'Darchula']] },
]

export const SHOP_TYPES: { id: string; ne: string; en: string; cats: [string, string][] }[] = [
  { id: 'kirana', ne: 'किराना पसल', en: 'Grocery (kirana)', cats: [] }, // the sample items bring their own categories
  { id: 'jutta', ne: 'जुत्ता पसल', en: 'Shoe shop', cats: [['पुरुष जुत्ता', "Men's shoes"], ['महिला जुत्ता', "Women's shoes"], ['बालबालिकाको जुत्ता', "Children's shoes"], ['चप्पल र स्यान्डल', 'Slippers and sandals'], ['स्पोर्ट्स र स्न्यिकर', 'Sports and sneakers'], ['मोजा, पालिस र अन्य', 'Socks, polish and others']] },
  { id: 'kapada', ne: 'कपडा पसल', en: 'Clothing', cats: [['पुरुष', 'Men'], ['महिला', 'Women'], ['बालबालिका', 'Children'], ['जाडो कपडा', 'Winter wear'], ['भित्री कपडा', 'Innerwear'], ['कपडा थान', 'Fabric by the metre']] },
  { id: 'mobile', ne: 'मोबाइल र इलेक्ट्रोनिक्स', en: 'Mobile and electronics', cats: [['मोबाइल', 'Mobile phones'], ['चार्जर र केबल', 'Chargers and cables'], ['इयरफोन र स्पिकर', 'Earphones and speakers'], ['कभर र ग्लास', 'Covers and glass'], ['घरायसी इलेक्ट्रोनिक्स', 'Home electronics']] },
  { id: 'pharmacy', ne: 'फार्मेसी', en: 'Pharmacy', cats: [['ट्याबलेट', 'Tablets'], ['सिरप', 'Syrups'], ['इन्जेक्सन', 'Injections'], ['मलम र ड्रप', 'Ointments and drops'], ['स्वास्थ्य सामग्री', 'Health supplies']] },
  { id: 'hardware', ne: 'हार्डवेयर', en: 'Hardware', cats: [['सिमेन्ट र छड', 'Cement and rods'], ['पाइप र फिटिङ', 'Pipes and fittings'], ['विद्युत सामग्री', 'Electrical'], ['रङ र ब्रस', 'Paint and brushes'], ['औजार', 'Tools']] },
  { id: 'stationery', ne: 'स्टेशनरी र किताब', en: 'Stationery and books', cats: [['कापी र किताब', 'Copies and books'], ['कलम र पेन्सिल', 'Pens and pencils'], ['कार्यालय सामग्री', 'Office supplies'], ['कला सामग्री', 'Art supplies']] },
  { id: 'cosmetic', ne: 'कस्मेटिक र सिङ्गार', en: 'Cosmetics', cats: [['अनुहारको सामान', 'Face care'], ['कपालको सामान', 'Hair care'], ['मेकअप', 'Makeup'], ['चुरा र पोते', 'Bangles and beads']] },
  { id: 'veg', ne: 'फलफूल र तरकारी', en: 'Fruit and vegetables', cats: [['तरकारी', 'Vegetables'], ['फलफूल', 'Fruit'], ['साग', 'Leafy greens'], ['मसला', 'Spices']] },
  { id: 'meat', ne: 'मासु पसल', en: 'Meat shop', cats: [['खसी / बोका', 'Goat'], ['कुखुरा', 'Chicken'], ['भैँसी', 'Buffalo'], ['माछा', 'Fish'], ['अण्डा', 'Eggs']] },
  { id: 'bakery', ne: 'बेकरी र मिठाई', en: 'Bakery and sweets', cats: [['केक', 'Cakes'], ['पाउरोटी', 'Bread'], ['मिठाई', 'Sweets'], ['नमकिन', 'Snacks']] },
  { id: 'jewel', ne: 'गहना पसल', en: 'Jewellery', cats: [['सुन', 'Gold'], ['चाँदी', 'Silver'], ['कृत्रिम गहना', 'Imitation']] },
  { id: 'furniture', ne: 'फर्निचर', en: 'Furniture', cats: [['ओछ्यान', 'Beds'], ['टेबल र कुर्सी', 'Tables and chairs'], ['दराज', 'Cupboards'], ['सोफा', 'Sofas']] },
  { id: 'other', ne: 'अन्य', en: 'Other', cats: [] },
]
export const shopTypeName = (id: string, lang: 'ne' | 'en', other?: string) => {
  const t = SHOP_TYPES.find((x) => x.id === id)
  return id === 'other' && other ? other : t ? (lang === 'ne' ? t.ne : t.en) : id
}
