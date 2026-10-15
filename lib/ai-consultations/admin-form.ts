import { z } from "zod";
import { AiDenied, publicationSchema, guidanceSchema } from "./contracts";
const booleanField=z.enum(["true","false"]).transform(value=>value==="true");
const versionField=z.string().max(10).regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(z.number().int().min(0).max(2147483647));
const publicationFormSchema=publicationSchema.extend({enabled:booleanField,expectedVersion:versionField});
const guidanceFormSchema=guidanceSchema.extend({approved:booleanField,expectedVersion:versionField});
function single(form:FormData,name:string) {
 const values=form.getAll(name);
 if(values.length!==1 || typeof values[0]!=="string")throw new AiDenied();
 return values[0];
}
function parse<Output,Input>(schema:z.ZodType<Output,z.ZodTypeDef,Input>,value:unknown):Output {
 const parsed=schema.safeParse(value);
 if(!parsed.success)throw new AiDenied();
 return parsed.data;
}
/** Boolean state is an explicit hidden field; missing submitter values never coerce to false. */
export function parsePublicationForm(form:FormData) {
 return parse(publicationFormSchema,{kind:single(form,"kind"),id:single(form,"id"),enabled:single(form,"enabled"),expectedVersion:single(form,"expectedVersion")});
}
export function parseGuidanceForm(form:FormData) {
 return parse(guidanceFormSchema,{topic:single(form,"topic"),approved:single(form,"approved"),expectedVersion:single(form,"expectedVersion")});
}
