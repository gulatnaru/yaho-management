import {describe,expect,it} from "vitest";
import {parsePublicationForm,parseGuidanceForm} from "@/lib/ai-consultations/admin-form";
function publication(enabled:string="true") {
 const form=new FormData();form.set("kind","PROGRAM");form.set("id","owned-program");form.set("expectedVersion","2");form.set("enabled",enabled);return form;
}
describe("explicit ADMIN action form fields",()=>{
 it.each(["true","false"])("preserves publication %s with no submitter field",value=>{
   expect(parsePublicationForm(publication(value))).toEqual({kind:"PROGRAM",id:"owned-program",expectedVersion:2,enabled:value==="true"});
 });
 it.each(["true","false"])("preserves guidance approval %s with no submitter field",value=>{
   const form=new FormData();form.set("topic","RAIN");form.set("expectedVersion","0");form.set("approved",value);
   expect(parseGuidanceForm(form)).toEqual({topic:"RAIN",expectedVersion:0,approved:value==="true"});
 });
 it.each([null,"TRUE","yes","0","","SYNTHETIC_PRIVATE_SENTINEL"])("rejects missing/invalid booleans with fixed errors",value=>{
   const form=publication();if(value===null)form.delete("enabled");else form.set("enabled",value);
   try{parsePublicationForm(form);throw new Error("UNEXPECTED_PASS");}catch(error){expect((error as Error).message).toBe("AI_REQUEST_DENIED");expect(error).not.toHaveProperty("issues");expect(JSON.stringify(error)).not.toContain("SYNTHETIC_PRIVATE_SENTINEL");}
 });
 it("rejects duplicate/File booleans and missing/noncanonical/out-of-range CAS versions",()=>{
   const duplicate=publication();duplicate.append("enabled","false");expect(()=>parsePublicationForm(duplicate)).toThrow("AI_REQUEST_DENIED");
   const file=publication();file.set("enabled",new Blob(["true"]));expect(()=>parsePublicationForm(file)).toThrow("AI_REQUEST_DENIED");
   for(const value of [null,""," 0","01","-1","1.5","2147483648"]){const form=publication();if(value===null)form.delete("expectedVersion");else form.set("expectedVersion",value);expect(()=>parsePublicationForm(form)).toThrow("AI_REQUEST_DENIED");}
 });
});
