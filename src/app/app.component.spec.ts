import { async, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { AppComponent } from './app.component';
import { ScriptService } from './script.service';

describe('AppComponent', () => {
  beforeEach(async(() => {
    TestBed.configureTestingModule({
      imports: [ReactiveFormsModule],
      declarations: [AppComponent],
      providers: [
        MessageService,
        { provide: ScriptService, useValue: { load: () => Promise.resolve() } }
      ]
    }).overrideComponent(AppComponent, {
      set: { template: '<div>Exam Paper Validator</div>' }
    }).compileComponents();
  }));

  it('should create the teacher page', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
